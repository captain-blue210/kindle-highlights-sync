import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import {
	DEFAULT_PROPERTY_NAMES as names,
	migrateProperties,
	readBookProperties,
	splitNote,
	validatePropertyNames,
	updateBookProperties,
} from "./note-properties";
const legacy =
	'---\nkindle-bookId: "45471"\nkindle-title: Example\nkindle-author: Original\nkindle-highlightsCount: 6\nkindle-asin: B0BD6C9QVR\nkindle-lastAnnotatedDate: 2025-09-21\nkindle-bookImageUrl: small.jpg\nauthor: Edited\nimage: large.jpg\ntags: [books]\n---\n\n> quote ^ref-123\n\nMy memo\n';
const data = (s: string) => parse(splitNote(s).frontmatter);
describe("Kindle property migration", () => {
	it("preserves edited values, all body bytes and book IDs while removing migrated keys", () => {
		const result = migrateProperties(legacy, names, []);
		expect(result.changed).toBe(true);
		expect(data(result.content)).toMatchObject({
			bookId: "45471",
			title: "Example",
			author: "Edited",
			highlights: 6,
			ASIN: "B0BD6C9QVR",
			image: "large.jpg",
			tags: ["books"],
		});
		expect(data(result.content)["kindle-author"]).toBeUndefined();
		expect(result.conflicts.map((c) => c.field)).toEqual([
			"author",
			"bookImageUrl",
		]);
		expect(splitNote(result.content).body).toBe(splitNote(legacy).body);
		expect(migrateProperties(result.content, names, []).content).toBe(
			result.content,
		);
	});
	it("keeps unknown nested keys and fills only empty targets, including zero counts", () => {
		const source =
			'---\nkindle-sync:\n  bookId: "123"\n  title: Nested\n  asin: ABC\n  author: Author\n  highlightsCount: 4\n  custom: keep\nauthor: ""\nhighlights: 0\n---\nBody';
		const result = migrateProperties(source, names, []);
		expect(data(result.content)).toMatchObject({
			bookId: "123",
			title: "Nested",
			author: "Author",
			highlights: 0,
			"kindle-sync": { custom: "keep" },
		});
		expect(splitNote(result.content).body).toBe("Body");
	});
	it("reads historical names after a settings rename", () => {
		const next = { ...names, title: "書名", asin: "識別番号" };
		const source =
			'---\nbookId: "123"\ntitle: Old name\nASIN: ABC\n---\nBody';
		expect(readBookProperties(source, next, [names])).toMatchObject({
			title: "Old name",
			asin: "ABC",
		});
		const result = migrateProperties(source, next, [names]);
		expect(data(result.content)).toMatchObject({
			書名: "Old name",
			識別番号: "ABC",
		});
		expect(data(result.content).ASIN).toBeUndefined();
	});
	it.each([
		"---\ntitle: [oops\n---\nBody",
		"---\nkindle-bookId: 1\nkindle-bookId: 2\n---\nBody",
		"---\n- sequence\n---\nBody",
		"---\nkindle-title: oops\n",
	])("rejects malformed frontmatter safely: %s", (source) => {
		expect(() => migrateProperties(source, names, [])).toThrow();
	});
	it("does not identify arbitrary reading notes as synced books", () => {
		const source = "---\ntitle: Other\nASIN: ABC\n---\nMemo";
		expect(readBookProperties(source, names, [])).toBeNull();
		expect(migrateProperties(source, names, []).content).toBe(source);
	});
	it("preserves CRLF bodies and YAML comments", () => {
		const source =
			'\uFEFF---\r\n# Keep this\r\nkindle-bookId: "123"\r\nkindle-title: T\r\n---\r\n\r\nMemo\r\n';
		const result = migrateProperties(source, names, []);
		expect(result.content).toContain("# Keep this");
		expect(splitNote(result.content).body).toBe("\r\nMemo\r\n");
	});
	it("rejects duplicate, unsafe or reserved property mappings", () => {
		expect(() =>
			validatePropertyNames({ ...names, title: "ASIN" }),
		).toThrow();
		expect(() =>
			validatePropertyNames({ ...names, title: "tags" }),
		).toThrow();
		expect(() =>
			validatePropertyNames({ ...names, title: "__proto__" }),
		).toThrow();
	});
	it("updates metadata without touching the body and keeps saved ID and curated image", () => {
		const migrated = migrateProperties(legacy, names, []).content;
		const result = updateBookProperties(
			migrated,
			{
				bookId: "new",
				title: "Example",
				asin: "B0BD6C9QVR",
				author: "Original",
				highlightsCount: 7,
				lastAnnotatedDate: "2026-10-08",
				bookImageUrl: "small.jpg",
			},
			names,
			[],
		);
		expect(data(result)).toMatchObject({
			bookId: "45471",
			author: "Edited",
			image: "large.jpg",
			highlights: 7,
			lastAnnotated: "2026-10-08",
		});
		expect(splitNote(result).body).toBe(splitNote(legacy).body);
	});
});
