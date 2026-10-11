import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	renameSync,
	rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readNoteDestinations } from "./note-destination";
import { afterEach, expect, it, vi } from "vitest";
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
const temporaryVaults: string[] = [];
afterEach(() => {
	for (const root of temporaryVaults.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function vault() {
	const path = "books/A.md";
	const root = mkdtempSync(join(tmpdir(), "kindle-34-vault-"));
	temporaryVaults.push(root);
	mkdirSync(join(root, "books"));
	const original = Object.assign(new TFile(), { path, stat: { ctime: 10 } });
	const files = new Map([[path, original]]),
		content = new Map([
			[path, "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nMemo\n"],
		]);
	writeFileSync(join(root, path), content.get(path)!);
	const app: any = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			getAbstractFileByPath: (p: string) => files.get(p),
			adapter: {
				read: async (p: string) => readFileSync(join(root, p), "utf8"),
				getBasePath: () => root,
			},
			process: async (file: TFile, fn: (s: string) => string) => {
				const updated = fn(readFileSync(join(root, file.path), "utf8"));
				content.set(file.path, updated);
				writeFileSync(join(root, file.path), updated);
			},
		},
	};
	return { path, original, files, content, app, root };
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
			noteDestinations: {
				ABC: {
					path: v.path,
					ctime: 10,
					fileId: io.fileIdentity!(v.path)!,
				},
			},
		},
		[{ id: "ABC", asin: "ABC", title: "Book" }],
		[{ id: "new", bookId: "ABC", text: "new", location: "20" }],
	);
	expect(r).toMatchObject({ held: 1, failed: 0, updated: 0, added: 0 });
	expect(v.content.get(v.path)).toBe(before);
});

it("holds an offline replacement preserving the Obsidian path and ctime using real filesystem identity", async () => {
	const v = vault(),
		oldIO = createVaultIO(v.app);
	const settings = {
		outputDirectory: "books",
		templateContent: "",
		propertyNames: DEFAULT_PROPERTY_NAMES,
		propertyNameHistory: [],
		noteDestinations: readNoteDestinations(
			JSON.parse(
				JSON.stringify({
					ABC: {
						path: v.path,
						ctime: 10,
						fileId: oldIO.fileIdentity!(v.path)!,
					},
				}),
			),
		),
	};
	renameSync(join(v.root, v.path), join(v.root, "books/Moved.md"));
	writeFileSync(join(v.root, v.path), v.content.get(v.path)!);
	const currentIO = createVaultIO(v.app); // a new plugin session has no old TFile pins or events
	expect(currentIO.identity!(v.path)).toBe(10);
	expect(currentIO.fileIdentity!(v.path)).not.toBe(
		settings.noteDestinations.ABC.fileId,
	);
	const before = readFileSync(join(v.root, v.path), "utf8");
	const result = await saveBookNotes(
		currentIO,
		settings,
		[{ id: "ABC", asin: "ABC", title: "Book" }],
		[{ id: "new", bookId: "ABC", text: "new", location: "20" }],
	);
	expect(result).toMatchObject({ held: 1, failed: 0, updated: 0 });
	expect(readFileSync(join(v.root, v.path), "utf8")).toBe(before);
});
it("updates only the selected filesystem note and preserves identity over two consecutive saves", async () => {
	const v = vault(),
		other = "books/Other.md",
		original = v.content.get(v.path)!;
	writeFileSync(join(v.root, other), original + "Other personal memo\n");
	v.files.set(
		other,
		Object.assign(new TFile(), { path: other, stat: { ctime: 10 } }),
	);
	const beforeOther = readFileSync(join(v.root, other));
	const io = createVaultIO(v.app),
		fileId = io.fileIdentity!(v.path)!;
	expect(fileId).toBeTypeOf("string");
	const settings = {
		outputDirectory: "books",
		templateContent: "",
		propertyNames: DEFAULT_PROPERTY_NAMES,
		propertyNameHistory: [],
		noteDestinations: { ABC: { path: v.path, ctime: 10, fileId } },
	};
	const books = [{ id: "ABC", asin: "ABC", title: "Book" }],
		hs = [{ id: "new", bookId: "ABC", text: "new", location: "20" }];
	expect((await saveBookNotes(io, settings, books, hs)).added).toBe(1);
	const after = readFileSync(join(v.root, v.path), "utf8");
	expect(
		(await saveBookNotes(createVaultIO(v.app), settings, books, hs)).added,
	).toBe(0);
	expect(readFileSync(join(v.root, v.path), "utf8")).toBe(after);
	expect(readFileSync(join(v.root, other))).toEqual(beforeOther);
	expect(createVaultIO(v.app).fileIdentity!(v.path)).toBe(fileId);
});
