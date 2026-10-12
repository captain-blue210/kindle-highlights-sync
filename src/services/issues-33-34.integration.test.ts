import { afterEach, describe, expect, it, vi } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	statSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
vi.mock("obsidian", () => ({ TFile: class {} }));
import { TFile } from "obsidian";
import { createVaultIO } from "./vault-io";
import { saveBookNotes } from "./note-writer";
import { annotationKey } from "./annotation-identity";
import { DEFAULT_PROPERTY_NAMES, splitNote } from "./note-properties";

const roots: string[] = [];
afterEach(() =>
	roots
		.splice(0)
		.forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const book = { id: "ABC", asin: "ABC", title: "Book" };
const h = (text: string, location: string, note?: string) => ({
	id: "generated",
	bookId: "ABC",
	text,
	location,
	note,
});
const remote = [
	h("abc", "10"),
	h("abc", "20"),
	h("aca", "30"),
	h("bab", "30"),
	h("", "40", "one note"),
	h("", "40", "two notes"),
	h("abc", "20"),
];
function filesystemVault() {
	const root = mkdtempSync(join(tmpdir(), "kindle-33-34-"));
	roots.push(root);
	mkdirSync(join(root, "books"));
	const a = "books/Renamed A.md",
		b = "books/Renamed B.md";
	const prefix =
		"---\nbookId: saved\ntitle: Edited\nASIN: ABC\ncustom: [keep, me]\n---\n\n";
	const sourceA =
		prefix +
		"> [[Related]] Edited abc ^ref-19495\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\nPersonal [[Other]]\n";
	const sourceB =
		prefix + "> [[Related]] Other edit ^ref-19495\n\nOther personal note\n";
	writeFileSync(join(root, a), sourceA);
	writeFileSync(join(root, b), sourceB);
	const files = new Map(
		[a, b].map((path) => [
			path,
			Object.assign(new TFile(), {
				path,
				stat: { ctime: statSync(join(root, path)).birthtimeMs },
			}),
		]),
	);
	const app: any = {
		vault: {
			getMarkdownFiles: () => [...files.values()],
			getAbstractFileByPath: (p: string) => files.get(p),
			adapter: {
				getBasePath: () => root,
				read: async (p: string) => readFileSync(join(root, p), "utf8"),
			},
			process: async (file: TFile, fn: (s: string) => string) =>
				writeFileSync(
					join(root, file.path),
					fn(readFileSync(join(root, file.path), "utf8")),
				),
		},
	};
	const settings = {
		outputDirectory: "books",
		templateContent: "{{highlights}}",
		propertyNames: DEFAULT_PROPERTY_NAMES,
		propertyNameHistory: [],
	};
	const read = (path: string) => readFileSync(join(root, path), "utf8");
	const select = (path: string) => {
		const io = createVaultIO(app);
		return {
			...settings,
			noteDestinations: {
				ABC: {
					path,
					ctime: io.identity!(path)!,
					fileId: io.fileIdentity!(path)!,
				},
			},
		};
	};
	return { root, a, b, sourceA, sourceB, files, app, settings, read, select };
}
describe("Issue #33 annotation ledger through Issue #34 persisted destination", () => {
	it("selects one real filesystem note, preserves the other and adds separate positions/collisions/notes once", async () => {
		const v = filesystemVault();
		const held = await saveBookNotes(
			createVaultIO(v.app),
			v.settings,
			[book],
			remote,
		);
		expect(held.outcomes?.[0]).toMatchObject({
			status: "held",
			reason: "destination-unselected",
			candidates: [v.a, v.b],
		});
		const settings = JSON.parse(JSON.stringify(v.select(v.a)));
		const first = await saveBookNotes(
			createVaultIO(v.app),
			settings,
			[book],
			remote,
		);
		expect(first).toMatchObject({
			added: 5,
			updated: 1,
			held: 0,
			failed: 0,
		});
		const after = v.read(v.a);
		expect(
			splitNote(after).body.startsWith(splitNote(v.sourceA).body),
		).toBe(true);
		expect(v.read(v.b)).toBe(v.sourceB);
		expect((after.match(/\^ks-/g) ?? []).length).toBe(5);
		expect(
			(
				await saveBookNotes(
					createVaultIO(v.app),
					JSON.parse(JSON.stringify(settings)),
					[book],
					remote,
				)
			).added,
		).toBe(0);
		expect(v.read(v.a)).toBe(after);
		const expanded = [...remote, h("later", "50")];
		expect(
			(
				await saveBookNotes(
					createVaultIO(v.app),
					settings,
					[book],
					expanded,
				)
			).added,
		).toBe(1);
		expect(
			(
				await saveBookNotes(
					createVaultIO(v.app),
					settings,
					[book],
					expanded,
				)
			).added,
		).toBe(0);
		expect(v.read(v.b)).toBe(v.sourceB);
	});
	it("requires new confirmation on switching destinations and never imports the first note's correspondence", async () => {
		const v = filesystemVault();
		await saveBookNotes(
			createVaultIO(v.app),
			v.select(v.a),
			[book],
			remote,
		);
		const aAfter = v.read(v.a);
		const wrongScope = {
			annotationOptionsByPath: {
				[v.a]: {
					bindings: {
						[annotationKey(h("abc", "10"), "ABC")]: "ref-19495",
					},
				},
			},
		};
		const held = await saveBookNotes(
			createVaultIO(v.app),
			v.select(v.b),
			[book],
			remote,
			undefined,
			undefined,
			wrongScope,
		);
		expect(held.held).toBe(1);
		expect(held.outcomes?.[0].heldAnnotations?.length).toBeGreaterThan(0);
		expect(v.read(v.b)).toBe(v.sourceB);
		expect(v.read(v.a)).toBe(aAfter);
		const confirmed = {
			annotationOptionsByPath: {
				[v.b]: {
					bindings: {
						[annotationKey(h("abc", "10"), "ABC")]: "ref-19495",
					},
					newSourceKeys: [annotationKey(h("abc", "20"), "ABC")],
				},
			},
		};
		const result = await saveBookNotes(
			createVaultIO(v.app),
			v.select(v.b),
			[book],
			remote,
			undefined,
			undefined,
			confirmed,
		);
		expect(result).toMatchObject({ added: 5, held: 0, failed: 0 });
		const bAfter = v.read(v.b);
		expect(
			(
				await saveBookNotes(
					createVaultIO(v.app),
					v.select(v.b),
					[book],
					remote,
				)
			).added,
		).toBe(0);
		expect(v.read(v.b)).toBe(bAfter);
		expect(v.read(v.a)).toBe(aAfter);
	});
	it("does not let transient target paths bypass a persisted invalidated destination", async () => {
		const v = filesystemVault();
		const selected = v.select(v.a);
		const settings = {
			...selected,
			noteDestinations: {
				ABC: {
					...selected.noteDestinations.ABC,
					invalidated: "deleted" as const,
				},
			},
		};
		const result = await saveBookNotes(
			createVaultIO(v.app),
			settings,
			[book],
			remote,
			undefined,
			undefined,
			{ targetPaths: { ABC: v.b } },
		);
		expect(result.held).toBe(1);
		expect(v.read(v.a)).toBe(v.sourceA);
		expect(v.read(v.b)).toBe(v.sourceB);
	});
	it("does not invalidate a valid persisted selection when the caller supplies a conflicting transient path", async () => {
		const v = filesystemVault();
		const settings = v.select(v.a);
		const originalSelection = JSON.parse(
			JSON.stringify(settings.noteDestinations),
		);
		const held = await saveBookNotes(
			createVaultIO(v.app),
			settings,
			[book],
			remote,
			undefined,
			undefined,
			{ targetPaths: { ABC: v.b } },
		);
		expect(held.held).toBe(1);
		expect(settings.noteDestinations).toEqual(originalSelection);
		expect(v.read(v.a)).toBe(v.sourceA);
		expect(v.read(v.b)).toBe(v.sourceB);
		expect(
			(
				await saveBookNotes(
					createVaultIO(v.app),
					settings,
					[book],
					remote,
				)
			).added,
		).toBe(5);
	});
});
