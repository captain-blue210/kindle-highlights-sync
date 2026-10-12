import {
	DestinationInvalidation,
	DestinationHoldReason,
	DestinationResolution,
	NoteDestinations,
	noteAsin,
	resolveNoteDestination,
} from "./note-destination";
import { BookStatus, SyncIssue, safeErrorMessage } from "./sync-progress";
import type { Book, Highlight } from "../models";
import {
	PropertyNames,
	readBookProperties,
	splitNote,
	updateBookProperties,
} from "./note-properties";
import {
	bookProperties,
	NoteSnapshot,
	renderHighlight,
	syncNoteContent,
} from "./note-sync";
import { renderTemplate } from "./template-renderer";
import { uniqueAnnotations } from "./annotation-identity";
import {
	AnnotationSyncOptions,
	HeldAnnotation,
	prepareNewNoteAnnotations,
} from "./annotation-sync";

export interface NoteWriterIO {
	/** Stable creation time; explicit selections require this capability. */
	identity?(path: string): number | undefined;
	/** Desktop filesystem identity, independent of user-preserved timestamps. */
	fileIdentity?(path: string): string | undefined;
	list(): string[];
	read(path: string): Promise<string>;
	create(path: string, content: string): Promise<void>;
	process(path: string, fn: (content: string) => string): Promise<void>;
}
export interface NoteWriterSettings {
	noteDestinations?: NoteDestinations;
	outputDirectory: string;
	templateContent: string;
	propertyNames: PropertyNames;
	propertyNameHistory: PropertyNames[];
}
export interface NoteSaveOutcome {
	asin: string;
	status: "created" | "updated" | "held" | "failed" | "skipped-no-highlights";
	path?: string;
	reason?: string;
	heldAnnotations?: HeldAnnotation[];
	candidates?: string[];
}
export interface NoteSaveOptions {
	targetPaths?: Record<string, string>;
	annotationOptionsByPath?: Record<string, AnnotationSyncOptions>;
}
export function normalizeOutputDirectory(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (
		normalized
			.split("/")
			.some(
				(part) => part === ".." || part === "." || part.startsWith("."),
			)
	)
		throw new Error("Invalid output directory");
	return normalized;
}
export interface NoteWriteResult {
	created: number;
	updated: number;
	added: number;
	held: number;
	failed: number;
	errors: string[];
	outcomes?: NoteSaveOutcome[];
	issues?: SyncIssue[];
}
export interface BookOutcome {
	status: BookStatus;
	issues: SyncIssue[];
}
export async function saveBookNotes(
	io: NoteWriterIO,
	settings: NoteWriterSettings,
	books: Book[],
	highlights: Highlight[],
	onBook?: (book: Book, index: number) => void,
	onBookSettled?: (book: Book, index: number, outcome: BookOutcome) => void,
	options: NoteSaveOptions = {},
): Promise<NoteWriteResult> {
	const output = normalizeOutputDirectory(settings.outputDirectory);
	const paths = io
		.list()
		.filter(
			(path) =>
				path.endsWith(".md") &&
				(output ? path.startsWith(output + "/") : !path.includes("/")),
		);
	const notes: NoteSnapshot[] = [];
	const scanIssues: SyncIssue[] = [];
	const result = {
		created: 0,
		updated: 0,
		added: 0,
		held: 0,
		failed: 0,
		errors: [] as string[],
		outcomes: [] as NoteSaveOutcome[],
		issues: scanIssues,
	};
	for (const path of paths) {
		try {
			notes.push({
				path,
				ctime: io.identity?.(path),
				fileId: io.fileIdentity?.(path),
				content: await io.read(path),
			});
		} catch {
			// A selected file removed after list() is a destination hold, not a failed scan.
			if (
				!io.list().includes(path) &&
				Object.values(settings.noteDestinations ?? {}).some(
					(s) => s.path === path,
				)
			)
				continue;
			result.errors.push(`${path}: unreadable note`);
			scanIssues.push({
				phase: "save",
				path,
				message: "Unreadable note",
			});
		}
	}
	// Missing an identity scan could create a duplicate of a renamed unreadable note.
	if (result.errors.length) {
		result.outcomes = books.map((book) => ({
			asin: book.asin,
			status: "failed",
			reason: "identity-scan-failed",
		}));
		result.failed = books.length;
		for (const [index, book] of books.entries())
			onBookSettled?.(book, index, {
				status: "failed",
				issues: scanIssues,
			});
		return result;
	}
	for (const [index, book] of books.entries()) {
		onBook?.(book, index);
		const bookHighlights = uniqueAnnotations(
			highlights.filter((h) => h.bookId === book.id),
			book.asin,
		);
		const outcome: BookOutcome = { status: "success", issues: [] };
		let resolution: DestinationResolution | undefined;
		try {
			const selectedPath = options.targetPaths?.[book.asin];
			const persisted = settings.noteDestinations?.[book.asin];
			if (
				persisted &&
				selectedPath !== undefined &&
				persisted.path !== selectedPath
			)
				throw new DestinationHeld({
					reason: "destination-invalid",
					invalidateSelection: false,
					candidates: notes
						.filter(
							(n) =>
								noteAsin(
									n,
									settings.propertyNames,
									settings.propertyNameHistory,
								) === book.asin,
						)
						.map((n) => n.path),
					selectedPath: persisted.path,
				});
			if (selectedPath !== undefined && !persisted) {
				const selected = notes.find((n) => n.path === selectedPath);
				if (!selected) throw new Error("Selected note is unavailable");
				if (
					noteAsin(
						selected,
						settings.propertyNames,
						settings.propertyNameHistory,
					) !== book.asin
				)
					throw new Error("Selected note has a different ASIN");
				// Transient result supplied by a caller. Persisted UI choices always use #34's identity guard.
				resolution = {
					status: "existing",
					note: selected,
					explicit: false,
				};
			} else
				resolution = resolveNoteDestination(
					notes,
					book,
					settings.noteDestinations,
					settings.propertyNames,
					settings.propertyNameHistory,
				);
			if (resolution.status === "held")
				throw new DestinationHeld(resolution);
			const existing =
				resolution.status === "existing" ? resolution.note : undefined;
			if (existing) {
				let added = 0,
					warnings: string[] = [];
				let heldAnnotations: HeldAnnotation[] = [];
				let savedContent = existing.content;
				await io.process(existing.path, (current) => {
					if (
						resolution?.status === "existing" &&
						resolution.explicit
					) {
						const fresh = resolveNoteDestination(
							[
								{
									path: existing.path,
									content: current,
									ctime: io.identity?.(existing.path),
									fileId: io.fileIdentity?.(existing.path),
								},
							],
							book,
							settings.noteDestinations,
							settings.propertyNames,
							settings.propertyNameHistory,
						);
						if (fresh.status === "held")
							throw new DestinationHeld({
								...fresh,
								candidates: notes
									.filter(
										(n) =>
											noteAsin(
												n,
												settings.propertyNames,
												settings.propertyNameHistory,
											) === book.asin,
									)
									.map((n) => n.path)
									.sort(),
							});
					}
					// Read fresh properties inside the atomic process, never apply a stale snapshot.
					const properties = readBookProperties(
						current,
						settings.propertyNames,
						settings.propertyNameHistory,
					);

					if (
						(selectedPath !== undefined &&
							noteAsin(
								{ path: existing.path, content: current },
								settings.propertyNames,
								settings.propertyNameHistory,
							) !== book.asin) ||
						(!properties &&
							noteAsin(
								{ path: existing.path, content: current },
								settings.propertyNames,
								settings.propertyNameHistory,
							) !== book.asin) ||
						(properties?.asin && properties.asin !== book.asin)
					)
						throw new Error(
							"Note identity changed during synchronization",
						);
					const merged = syncNoteContent(
						current,
						book,
						bookHighlights,
						settings.propertyNames,
						settings.propertyNameHistory,
						options.annotationOptionsByPath?.[existing.path],
					);
					added = merged.added;
					warnings = merged.warnings;
					heldAnnotations = merged.heldAnnotations;
					outcome.status =
						merged.content === current ? "unchanged" : "success";
					savedContent = merged.content;
					return merged.content;
				});
				existing.content = savedContent;
				if (warnings.length) {
					result.held++;
					result.outcomes.push({
						asin: book.asin,
						status: "held",
						path: existing.path,
						reason: warnings.join("; "),
						heldAnnotations,
					});
					outcome.status = "held";
					outcome.issues = warnings.map((message) => ({
						phase: "save",
						bookTitle: book.title,
						path: existing.path,
						message,
					}));
					result.errors.push(
						`${existing.path}: ${warnings.join("; ")}`,
					);
				} else {
					result.updated++;
					result.outcomes.push({
						asin: book.asin,
						status: "updated",
						path: existing.path,
					});
					result.added += added;
				}
			} else {
				if (!bookHighlights.length) {
					result.outcomes.push({
						asin: book.asin,
						status: "skipped-no-highlights",
					});
					outcome.status = "unchanged";
					continue;
				}
				if (
					notes.some(
						(n) =>
							n.content.includes(book.asin) &&
							!safeProperties(n.content, settings),
					)
				)
					throw new Error(
						"Existing note cannot be safely identified",
					);
				const filename =
					book.title
						.replace(/[\\/:*?"<>|\[\]#^]/g, "_")
						.replace(/^\.+/, "_")
						.trim() || book.asin;
				const path = (output ? output + "/" : "") + filename + ".md";
				if (io.list().includes(path))
					throw new Error(
						"An unrelated note already uses this filename",
					);
				const props = bookProperties(book, bookHighlights.length);
				const rendered = renderTemplate(settings.templateContent, {
					book,
					...book,
					highlights: bookHighlights
						.map((h) => renderHighlight(h, book.asin))
						.join("\n\n"),
					highlightsCount: bookHighlights.length,
					lastAnnotatedDate: props.lastAnnotatedDate,
					authorUrl: book.metadata?.authorUrl,
					publicationDate: book.metadata?.publicationDate,
					publisher: book.metadata?.publisher,
					appLink: `kindle://book?action=open&asin=${encodeURIComponent(book.asin)}`,
				});
				const renderedParts = splitNote(rendered);
				const prepared = prepareNewNoteAnnotations(
					renderedParts.body,
					bookHighlights,
					book.asin,
				);
				if (prepared.warnings.length) {
					result.held++;
					result.outcomes.push({
						asin: book.asin,
						status: "held",
						path,
						reason: prepared.warnings.join("; "),
						heldAnnotations: prepared.heldAnnotations,
					});
					outcome.status = "held";
					outcome.issues = prepared.warnings.map((message) => ({
						phase: "save",
						bookTitle: book.title,
						path,
						message,
					}));
					result.errors.push(
						`${path}: ${prepared.warnings.join("; ")}`,
					);
					continue;
				}
				const withLedger =
					rendered.slice(
						0,
						rendered.length - renderedParts.body.length,
					) + prepared.body;
				const content = updateBookProperties(
					withLedger,
					props,
					settings.propertyNames,
					settings.propertyNameHistory,
				);
				splitNote(content); // A malformed custom template never becomes a note.
				await io.create(path, content);
				notes.push({ path, content });
				result.created++;
				result.outcomes.push({
					asin: book.asin,
					status: "created",
					path,
				});
				result.added += bookHighlights.length;
			}
		} catch (error) {
			if (
				resolution?.status === "existing" &&
				resolution.explicit &&
				error instanceof Error &&
				[
					"Note unavailable",
					"Note identity changed during synchronization",
				].includes(error.message)
			) {
				error = new DestinationHeld({
					reason: io.list().includes(resolution.note.path)
						? "destination-identity-changed"
						: "destination-missing",
					candidates: notes
						.filter(
							(n) =>
								noteAsin(
									n,
									settings.propertyNames,
									settings.propertyNameHistory,
								) === book.asin,
						)
						.map((n) => n.path)
						.sort(),
					selectedPath: resolution.note.path,
				});
			}
			if (error instanceof DestinationHeld) {
				result.held++;
				const { reason, candidates, selectedPath } = error.resolution;
				const selected = settings.noteDestinations?.[book.asin];
				if (
					selected &&
					selectedPath === selected.path &&
					error.resolution.invalidateSelection !== false &&
					!selected.invalidated
				) {
					selected.invalidated = reason.replace(
						"destination-",
						"",
					) as DestinationInvalidation;
				}
				result.outcomes.push({
					asin: book.asin,
					status: "held",
					reason,
					candidates,
					...(selectedPath ? { path: selectedPath } : {}),
				});
				outcome.status = "held";
				outcome.issues.push({
					phase: "save",
					bookTitle: book.title,
					...(selectedPath ? { path: selectedPath } : {}),
					message: reason,
				});
				for (const path of candidates)
					outcome.issues.push({
						phase: "save",
						bookTitle: book.title,
						path,
						message:
							"Destination candidate; choose a sync destination in settings",
					});
				result.errors.push(`${book.title}: ${reason}`);
			} else {
				result.failed++;
				result.outcomes.push({
					asin: book.asin,
					status: "failed",
					reason:
						error instanceof Error &&
						error.message === "Multiple notes have the same ASIN"
							? "duplicate-note-asin"
							: "note-save-failed",
				});
				outcome.status = "failed";
				const message = safeErrorMessage(error);
				outcome.issues.push({
					phase: "save",
					bookTitle: book.title,
					message,
				});
				result.errors.push(`${book.title}: ${message}`);
			}
		} finally {
			result.issues.push(...outcome.issues);
			onBookSettled?.(book, index, outcome);
		}
	}
	return result;
}
function safeProperties(content: string, settings: NoteWriterSettings) {
	try {
		return readBookProperties(
			content,
			settings.propertyNames,
			settings.propertyNameHistory,
		);
	} catch {
		return null;
	}
}

class DestinationHeld extends Error {
	constructor(
		readonly resolution: {
			reason: DestinationHoldReason;
			candidates: string[];
			selectedPath?: string;
			/** Caller disagreement is not evidence that the persisted file changed. */
			invalidateSelection?: boolean;
		},
	) {
		super(resolution.reason);
	}
}
