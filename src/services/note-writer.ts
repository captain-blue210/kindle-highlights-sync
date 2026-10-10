import type { Book, Highlight } from "../models";
import {
	PropertyNames,
	readBookProperties,
	splitNote,
	updateBookProperties,
} from "./note-properties";
import {
	bookProperties,
	findExistingNote,
	NoteSnapshot,
	renderHighlight,
	syncNoteContent,
} from "./note-sync";
import { renderTemplate } from "./template-renderer";

export interface NoteWriterIO {
	list(): string[];
	read(path: string): Promise<string>;
	create(path: string, content: string): Promise<void>;
	process(path: string, fn: (content: string) => string): Promise<void>;
}
export interface NoteWriterSettings {
	outputDirectory: string;
	templateContent: string;
	propertyNames: PropertyNames;
	propertyNameHistory: PropertyNames[];
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
export async function saveBookNotes(
	io: NoteWriterIO,
	settings: NoteWriterSettings,
	books: Book[],
	highlights: Highlight[],
	onBook?: (book: Book, index: number) => void,
) {
	const output = normalizeOutputDirectory(settings.outputDirectory);
	const paths = io
		.list()
		.filter(
			(path) =>
				path.endsWith(".md") &&
				(output ? path.startsWith(output + "/") : !path.includes("/")),
		);
	const notes: NoteSnapshot[] = [];
	const result = {
		created: 0,
		updated: 0,
		added: 0,
		held: 0,
		failed: 0,
		errors: [] as string[],
	};
	for (const path of paths) {
		try {
			notes.push({ path, content: await io.read(path) });
		} catch {
			result.errors.push(`${path}: unreadable note`);
		}
	}
	// Missing an identity scan could create a duplicate of a renamed unreadable note.
	if (result.errors.length) {
		result.failed = Math.max(books.length, result.errors.length);
		return result;
	}
	for (const [index, book] of books.entries()) {
		onBook?.(book, index);
		const bookHighlights = highlights.filter((h) => h.bookId === book.id);
		try {
			const existing = findExistingNote(
				notes,
				book,
				settings.propertyNames,
				settings.propertyNameHistory,
			);
			if (existing) {
				let added = 0,
					warnings: string[] = [];
				await io.process(existing.path, (current) => {
					// Read fresh properties inside the atomic process, never apply a stale snapshot.
					const properties = readBookProperties(
						current,
						settings.propertyNames,
						settings.propertyNameHistory,
					);
					if (
						!properties ||
						(properties.asin && properties.asin !== book.asin)
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
					);
					added = merged.added;
					warnings = merged.warnings;
					existing.content = merged.content;
					return merged.content;
				});
				if (warnings.length) {
					result.held++;
					result.errors.push(
						`${existing.path}: ${warnings.join("; ")}`,
					);
				} else {
					result.updated++;
					result.added += added;
				}
			} else {
				if (!bookHighlights.length) continue;
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
				const content = updateBookProperties(
					rendered,
					props,
					settings.propertyNames,
					settings.propertyNameHistory,
				);
				splitNote(content); // A malformed custom template never becomes a note.
				await io.create(path, content);
				notes.push({ path, content });
				result.created++;
				result.added += bookHighlights.length;
			}
		} catch {
			result.failed++;
			result.errors.push(
				`${book.title}: note could not be safely updated`,
			);
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
