import { describe, it, expect } from "vitest";
import { DEFAULT_PROPERTY_NAMES as names } from "./note-properties";
import { previewMigration, runMigration } from "./property-migration";
const source =
	'---\nkindle-bookId: "123"\nkindle-title: Book\n---\n\nKeep memo\n';
function vault() {
	const files = new Map([
		["books/book.md", source],
		["books/other.md", "ordinary note"],
	]);
	const writes: string[] = [];
	return {
		files,
		writes,
		read: async (p: string) => {
			if (!files.has(p)) throw Error("missing");
			return files.get(p)!;
		},
		write: async (p: string, s: string) => {
			writes.push(p);
			files.set(p, s);
		},
		exists: async (p: string) => files.has(p),
	};
}
describe("bulk migration transaction", () => {
	it("backs up every original before modifying any note and is repeatable", async () => {
		const v = vault();
		const preview = await previewMigration(
			["books/book.md", "books/other.md"],
			v,
			names,
			[],
		);
		expect(preview.changed).toBe(1);
		expect(preview.skipped).toBe(1);
		const result = await runMigration(
			preview,
			v,
			".obsidian/plugins/kindle-highlights-sync/backups/test",
		);
		expect(result.migrated).toBe(1);
		expect(v.writes[0]).toBe(
			".obsidian/plugins/kindle-highlights-sync/backups/test/books/book.md",
		);
		expect(v.files.get(v.writes[0])).toBe(source);
		expect(v.files.get("books/book.md")).toContain("Keep memo");
		expect(
			(await previewMigration(["books/book.md"], v, names, [])).changed,
		).toBe(0);
	});
	it("aborts all note writes if a backup fails", async () => {
		const v = vault();
		const p = await previewMigration(["books/book.md"], v, names, []);
		v.write = async () => {
			throw Error("disk full");
		};
		await expect(
			runMigration(p, v, ".obsidian/backups/test"),
		).rejects.toThrow("disk full");
		expect(v.files.get("books/book.md")).toBe(source);
	});
	it("does not overwrite edits made after preview", async () => {
		const v = vault();
		const p = await previewMigration(["books/book.md"], v, names, []);
		v.files.set("books/book.md", source + "New memo");
		const result = await runMigration(p, v, ".obsidian/backups/test");
		expect(result.failed).toBe(1);
		expect(result.migrated).toBe(0);
		expect(v.files.get("books/book.md")).toBe(source + "New memo");
	});
	it("counts invalid YAML without changing it", async () => {
		const v = vault();
		v.files.set("books/bad.md", "---\nkindle-bookId: [oops\n---\nMemo");
		const p = await previewMigration(
			["books/book.md", "books/bad.md"],
			v,
			names,
			[],
		);
		expect(p.failed).toBe(1);
		expect(p.changed).toBe(1);
	});
});
