import {
	annotationText,
	uniqueAnnotations,
	renderAnnotation,
} from "./annotation-identity";
import { AnnotationSyncOptions, reconcileAnnotations } from "./annotation-sync";
import { kindleHash } from "./annotation-identity";
export { kindleHash } from "./annotation-identity";
import type { Book, Highlight } from "../models";
import {
	BookProperties,
	DEFAULT_PROPERTY_NAMES,
	PropertyNames,
	readBookProperties,
	splitNote,
	updateBookProperties,
} from "./note-properties";

export const renderHighlight = renderAnnotation;
export const mergeHighlights = reconcileAnnotations;
export interface NoteSnapshot {
	path: string;
	content: string;
}
export function findExistingNote(
	notes: NoteSnapshot[],
	book: Book,
	names: PropertyNames = DEFAULT_PROPERTY_NAMES,
	history: PropertyNames[] = [],
): NoteSnapshot | undefined {
	const recognized = notes.map((note) => {
		try {
			return {
				note,
				properties: readBookProperties(note.content, names, history),
			};
		} catch {
			return { note, properties: null };
		}
	});
	const byAsin = recognized.filter((n) => n.properties?.asin === book.asin);
	if (byAsin.length > 1) throw new Error("Multiple notes have the same ASIN");
	if (byAsin.length === 1) return byAsin[0].note;
	const byId = recognized.filter(
		(n) =>
			n.properties?.bookId === kindleHash(book.title) ||
			n.properties?.bookId === book.id,
	);
	if (byId.length > 1)
		throw new Error("Multiple notes have the same book ID");
	return byId[0]?.note;
}
export function bookProperties(
	book: Book,
	highlightsCount: number,
): BookProperties {
	const validDate =
		book.lastAnnotatedDate &&
		Number.isFinite(book.lastAnnotatedDate.getTime());
	return {
		bookId: kindleHash(book.title),
		title: book.title,
		author: book.author,
		asin: book.asin,
		highlightsCount,
		lastAnnotatedDate: validDate
			? book.lastAnnotatedDate!.toISOString().slice(0, 10)
			: undefined,
		bookImageUrl: book.imageUrl,
	};
}
export function syncNoteContent(
	content: string,
	book: Book,
	highlights: Highlight[],
	names: PropertyNames = DEFAULT_PROPERTY_NAMES,
	history: PropertyNames[] = [],
	options: AnnotationSyncOptions = {},
) {
	const parts = splitNote(content),
		merged = mergeHighlights(parts.body, highlights, book.asin, options);
	if (merged.warnings.length)
		return {
			content,
			added: 0,
			warnings: merged.warnings,
			heldAnnotations: merged.heldAnnotations,
		};
	// Only replace the body suffix, keeping frontmatter available for the metadata merger.
	const withBody =
		content.slice(0, content.length - parts.body.length) + merged.body;
	return {
		content: updateBookProperties(
			withBody,
			bookProperties(
				book,
				uniqueAnnotations(highlights, book.asin).filter((h) =>
					annotationText(h).trim(),
				).length,
			),
			names,
			history,
		),
		added: merged.added,
		warnings: [],
		heldAnnotations: merged.heldAnnotations,
	};
}
