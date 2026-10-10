import { describe, it, expect } from "vitest";
import {
	kindleHash,
	mergeHighlights,
	findExistingNote,
	syncNoteContent,
} from "./note-sync";
import {
	DEFAULT_PROPERTY_NAMES as names,
	readBookProperties,
	splitNote,
} from "./note-properties";
import type { Book, Highlight } from "../models";
const book: Book = {
	id: "ABC",
	asin: "ABC",
	title: "Book",
	lastAnnotatedDate: new Date("2026-10-08T00:00:00Z"),
};
const h = (text: string, location: string): Highlight => ({
	id: `legacy-${location}`,
	bookId: "ABC",
	text,
	location,
});
describe("append-only Kindle sync", () => {
	it("uses hadynz Fletcher16 book/highlight identities", () => {
		expect(kindleHash("abc")).toBe("19495");
		expect(kindleHash("ABC")).toBe("19495");
		expect(
			kindleHash(
				"邪宗館の惨劇 作家・那々木悠志郎シリーズ (角川ホラー文庫)",
			),
		).toBe("45471");
	});
	it("preserves edited anchored highlights, memos, filenames and adds only new highlights", () => {
		const body = "> My edited abc ^ref-19495\n\nPersonal memo\n";
		const result = mergeHighlights(
			body,
			[h("abc", "10"), h("new", "20")],
			"ABC",
		);
		expect(result.added).toBe(1);
		expect(result.body.startsWith(body)).toBe(true);
		expect(result.body).toContain("location=20");
		expect(result.body).not.toContain("legacy-20");
		expect(
			mergeHighlights(
				result.body,
				[h("abc", "10"), h("new", "20")],
				"ABC",
			).added,
		).toBe(0);
	});
	it("recognizes unanchored highlights by exact text and location", () => {
		const body =
			"> abc\n> Location: [10](kindle://book?action=open&asin=ABC&location=10)\n\nMemo\n";
		const result = mergeHighlights(
			body,
			[h("abc", "10"), h("new", "20")],
			"ABC",
		);
		expect(result.added).toBe(1);
		expect(result.warnings).toEqual([]);
	});
	it("holds ambiguous unanchored edits instead of duplicating a highlight", () => {
		const body =
			"> Edited quote\n> Location: [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const result = mergeHighlights(
			body,
			[h("Original quote", "10"), h("new", "20")],
			"ABC",
		);
		expect(result.added).toBe(0);
		expect(result.body).toBe(body);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
	it("holds legacy notes whose highlights have no identifiers or location links", () => {
		const body = "## ハイライト\n\n> Unknown quote\n\nMemo\n";
		const result = mergeHighlights(body, [h("new", "20")], "ABC");
		expect(result.added).toBe(0);
		expect(result.body).toBe(body);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
	it("handles repeated remote highlights and Fletcher16 collisions conservatively", () => {
		// Same letters in different order can have a 16-bit collision; values checked independently.
		const result = mergeHighlights(
			"",
			[h("abc", "10"), h("abc", "10")],
			"ABC",
		);
		expect(result.added).toBe(1);
	});
	it("finds renamed notes by ASIN before titles or hash IDs and rejects duplicate ASINs", () => {
		const note = {
			path: "books/My title.md",
			content: '---\nbookId: "999"\ntitle: Edited\nASIN: ABC\n---\nMemo',
		};
		expect(findExistingNote([note], book, names, [])?.path).toBe(note.path);
		expect(() =>
			findExistingNote(
				[note, { ...note, path: "books/Other.md" }],
				book,
				names,
				[],
			),
		).toThrow("Multiple");
	});
	it("updates metadata for zero-new-highlight sync without rewriting the body", () => {
		const source =
			'---\nbookId: "999"\ntitle: Book\nASIN: ABC\nhighlights: 1\nlastAnnotated: Invalid date\n---\n\n> Edited abc ^ref-19495\n\nMy memo\n';
		const result = syncNoteContent(
			source,
			book,
			[h("abc", "10")],
			names,
			[],
		);
		expect(result.added).toBe(0);
		expect(splitNote(result.content).body).toBe(splitNote(source).body);
		expect(readBookProperties(result.content, names, [])).toMatchObject({
			bookId: "999",
			lastAnnotatedDate: "2026-10-08",
			highlightsCount: 1,
		});
	});
	it("does not invent a lastAnnotated date when Amazon returns invalid input", () => {
		const source =
			'---\nbookId: "999"\ntitle: Book\nASIN: ABC\nlastAnnotated: 2025-09-21\n---\n> abc ^ref-19495';
		const result = syncNoteContent(
			source,
			{ ...book, lastAnnotatedDate: new Date("bad") },
			[h("abc", "10")],
			names,
			[],
		);
		expect(
			readBookProperties(result.content, names, [])?.lastAnnotatedDate,
		).toBe("2025-09-21");
	});
});
