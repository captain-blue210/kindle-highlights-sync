import { expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({
	TFile: class {
		constructor(
			public path: string,
			public stat = { ctime: 10 },
		) {}
	},
}));
import { TFile } from "obsidian";
import { createVaultIO } from "./vault-io";
import { saveBookNotes } from "./note-writer";
import { DEFAULT_PROPERTY_NAMES } from "./note-properties";
function vault() {
	const path = "books/A.md";
	const original = Object.assign(new TFile(), { path, stat: { ctime: 10 } });
	const files = new Map([[path, original]]),
		content = new Map([
			[path, "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nMemo\n"],
		]);
	const app: any = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			getAbstractFileByPath: (p: string) => files.get(p),
			adapter: { read: async (p: string) => content.get(p)! },
			process: async (file: TFile, fn: (s: string) => string) => {
				content.set(file.path, fn(content.get(file.path)!));
			},
		},
	};
	return { path, original, files, content, app };
}
it("pins scanned TFile objects even if a replacement has the same path and timestamp", async () => {
	const v = vault(),
		io = createVaultIO(v.app);
	v.files.set(
		v.path,
		Object.assign(new TFile(), { path: v.path, stat: { ctime: 10 } }),
	);
	await expect(io.process(v.path, () => "overwritten")).rejects.toThrow(
		"identity changed",
	);
	expect(v.content.get(v.path)).toContain("Memo");
	expect(io.identity?.(v.path)).toBeUndefined();
});
it("checks the file pin again inside the atomic callback", async () => {
	const v = vault(),
		io = createVaultIO(v.app);
	const process = v.app.vault.process;
	v.app.vault.process = async (file: TFile, fn: (s: string) => string) => {
		v.files.set(
			v.path,
			Object.assign(new TFile(), { path: v.path, stat: { ctime: 10 } }),
		);
		return process(file, fn);
	};
	await expect(io.process(v.path, () => "overwritten")).rejects.toThrow(
		"identity changed",
	);
	expect(v.content.get(v.path)).toContain("Memo");
});
it("reports a selected-file race through real Vault IO as held and keeps the replacement unchanged", async () => {
	const v = vault(),
		io = createVaultIO(v.app),
		before = v.content.get(v.path);
	const process = v.app.vault.process;
	v.app.vault.process = async (file: TFile, fn: (s: string) => string) => {
		v.files.set(
			v.path,
			Object.assign(new TFile(), { path: v.path, stat: { ctime: 10 } }),
		);
		return process(file, fn);
	};
	const r = await saveBookNotes(
		io,
		{
			outputDirectory: "books",
			templateContent: "",
			propertyNames: DEFAULT_PROPERTY_NAMES,
			propertyNameHistory: [],
			noteDestinations: { ABC: { path: v.path, ctime: 10 } },
		},
		[{ id: "ABC", asin: "ABC", title: "Book" }],
		[{ id: "new", bookId: "ABC", text: "new", location: "20" }],
	);
	expect(r).toMatchObject({ held: 1, failed: 0, updated: 0, added: 0 });
	expect(v.content.get(v.path)).toBe(before);
});
