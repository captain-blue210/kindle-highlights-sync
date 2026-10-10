import { Buffer } from "buffer";
import type { Book, Highlight } from "../models";
import {
	BookProperties,
	DEFAULT_PROPERTY_NAMES,
	PropertyNames,
	readBookProperties,
	splitNote,
	updateBookProperties,
} from "./note-properties";

/** hadynz/obsidian-kindle-plugin: Fletcher16 of lowercased UTF-8 bytes. */
export function kindleHash(text: string): string {
	let a = 0,
		b = 0;
	for (const byte of Buffer.from(text.toLowerCase(), "utf8")) {
		a = (a + byte) % 255;
		b = (b + a) % 255;
	}
	return String((b << 8) | a);
}
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const locationNumber = (location: string | undefined) =>
	location?.match(/\d+$/)?.[0];
function visibleMarkdown(body: string): string {
	let fence: string | null = null;
	return body
		.split(/\r?\n/)
		.map((line) => {
			const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
			if (match) {
				if (!fence) fence = match[1];
				else if (
					match[1][0] === fence[0] &&
					match[1].length >= fence.length
				)
					fence = null;
				return "";
			}
			return fence ? "" : line;
		})
		.join("\n");
}
export function renderHighlight(h: Highlight, asin: string): string {
	const loc = locationNumber(h.location);
	const link = `kindle://book?action=open&asin=${encodeURIComponent(asin)}${loc ? `&location=${loc}` : ""}`;
	const quoted = h.text
		.split(/\r?\n/)
		.map((line) => `> ${line}`)
		.join("\n");
	return `${quoted} ^ref-${kindleHash(h.text)}\n> [${h.location || "Kindle"}](${link})${h.note ? `\n\n${h.note}` : ""}`;
}
export function mergeHighlights(
	body: string,
	highlights: Highlight[],
	asin: string,
): { body: string; added: number; warnings: string[] } {
	const visible = visibleMarkdown(body);
	const anchors = new Set(
		Array.from(visible.matchAll(/\^ref-(\d+)(?=\s|$)/g), (m) => m[1]),
	);
	const warnings: string[] = [];
	const unique = new Map<string, Highlight>();
	for (const h of highlights) {
		if (!h.text?.trim()) continue;
		const id = kindleHash(h.text),
			previous = unique.get(id);
		if (previous && normalize(previous.text) !== normalize(h.text)) {
			warnings.push("Highlight ID collision; note left unchanged");
			break;
		}
		if (!previous) unique.set(id, h);
	}
	const unanchored: { text: string; location?: string }[] = [];
	for (const block of visible.match(/^>.*(?:\n^>.*)*/gm) ?? []) {
		if (/\^ref-\d+(?=\s|$)/.test(block)) continue;
		const link = /kindle:\/\/book\?[^\s)]+/.exec(block);
		let location: string | undefined;
		if (link) {
			try {
				const url = new URL(link[0]);
				if (url.searchParams.get("asin") === asin)
					location = url.searchParams.get("location") ?? undefined;
			} catch {}
		}
		const text = normalize(
			block
				.split("\n")
				.filter((l) => !l.includes("kindle://"))
				.map((l) => l.replace(/^>\s?/, ""))
				.join("\n"),
		);
		unanchored.push({ text, location });
	}
	// Unknown old quote blocks cannot be distinguished from edited or handwritten highlights.
	if (unanchored.some((h) => !h.location))
		warnings.push("Unanchored quote has no location; note left unchanged");
	const missing: Highlight[] = [];
	for (const [id, h] of unique) {
		if (anchors.has(id)) continue;
		const loc = locationNumber(h.location);
		const sameLocation = unanchored.filter(
			(old) => old.location === loc && loc !== undefined,
		);
		if (sameLocation.length) {
			if (
				sameLocation.length === 1 &&
				sameLocation[0].text === normalize(h.text)
			)
				continue;
			warnings.push(
				"Unanchored highlight differs at the same location; note left unchanged",
			);
		} else missing.push(h);
	}
	if (warnings.length) return { body, added: 0, warnings };
	if (!missing.length) return { body, added: 0, warnings: [] };
	const newline = body.includes("\r\n") ? "\r\n" : "\n";
	const append = missing
		.map((h) => renderHighlight(h, asin).replace(/\n/g, newline))
		.join(newline + newline);
	return {
		body:
			body +
			(body.endsWith(newline + newline)
				? ""
				: body.endsWith(newline)
					? newline
					: body
						? newline + newline
						: "") +
			append +
			newline,
		added: missing.length,
		warnings: [],
	};
}
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
) {
	const parts = splitNote(content),
		merged = mergeHighlights(parts.body, highlights, book.asin);
	if (merged.warnings.length)
		return { content, added: 0, warnings: merged.warnings };
	// Only replace the body suffix, keeping frontmatter available for the metadata merger.
	const withBody =
		content.slice(0, content.length - parts.body.length) + merged.body;
	return {
		content: updateBookProperties(
			withBody,
			bookProperties(
				book,
				highlights.filter((h) => h.text?.trim()).length,
			),
			names,
			history,
		),
		added: merged.added,
		warnings: [],
	};
}
