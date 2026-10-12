import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ Notice: vi.fn() }));
import type { Book } from "../models";
import { notebookWindow, libraryHtml } from "../test-utils/notebook-window";
import {
	beginBookSync,
	finishBookSync,
	readBookSyncState,
	selectBooksForSync,
	type BookSyncContext,
} from "./book-sync-state";
import { KindleApiService } from "./kindle-api";
import type { NoteDestinations } from "./note-destination";
import { DEFAULT_PROPERTY_NAMES, splitNote } from "./note-properties";
import { saveBookNotes } from "./note-writer";

interface RemoteBook {
	day: string | null;
	annotations: { text?: string; note?: string; location: string }[];
	unavailable?: boolean;
}
const original = { text: "abc", location: "10" };
const remoteBook = (day = "2026-10-01"): RemoteBook => ({
	day,
	annotations: [original],
});
const source =
	'---\nbookId: "saved"\ntitle: Original\nASIN: ABC\ncustom: keep\n---\n\n' +
	"> [[Related]] Edited abc ^ref-19495\n" +
	"> [10](kindle://book?action=open&asin=ABC&location=10)\n\n" +
	"Personal memo [[Other]]\n";
const renamedPath = "books/My renamed book.md";

function incrementalSync(
	remote: Record<string, RemoteBook>,
	initial: Record<string, string> = {},
) {
	const files = new Map(Object.entries(initial));
	const requests: string[] = [];
	let serialized = "{}";
	const settings = {
		outputDirectory: "books",
		templateContent: "# {{title}}\n\n{{highlights}}\n",
		propertyNames: DEFAULT_PROPERTY_NAMES,
		propertyNameHistory: [],
		noteDestinations: {} as NoteDestinations,
	};
	const io = {
		identity: () => 1,
		fileIdentity: (path: string) => `file:${path}`,
		list: () => [...files.keys()],
		read: async (path: string) => files.get(path)!,
		create: async (path: string, content: string) => {
			if (files.has(path)) throw new Error("An unrelated note already uses this filename");
			files.set(path, content);
		},
		process: async (path: string, fn: (content: string) => string) => {
			files.set(path, fn(files.get(path)!));
		},
	};
	const window = notebookWindow((url) => {
		const asin = new URL(url).searchParams.get("asin");
		if (!asin) {
			const rows = Object.entries(remote)
				.map(([id, book]) =>
					`<div class="kp-notebook-library-each-book" id="${id}"><h2 class="kp-notebook-searchable">Book ${id}</h2><input id="kp-notebook-annotated-date-${id}" value="${book.day ?? ""}"></div>`,
				)
				.join("");
			return libraryHtml([], true).replace(
				'<div id="kp-notebook-library"></div>',
				`<div id="kp-notebook-library">${rows}</div>`,
			);
		}
		if (remote[asin].unavailable) return "<p>Annotation page unavailable</p>";
		return '<input class="kp-notebook-content-limit-state" value="">' +
			'<input class="kp-notebook-annotations-next-page-start" value="">' +
				remote[asin].annotations.map((annotation) => {
					const highlight = annotation.text === undefined
						? "" : `<span id="highlight">${annotation.text}</span>`;
					const note = annotation.note === undefined
						? "" : `<span id="note">${annotation.note}</span>`;
					return `<div class="a-row a-spacing-base">${highlight}${note}<input id="kp-annotation-location" value="${annotation.location}"></div>`;
				}).join("");
	});
	const loadURL = window.loadURL;
	window.loadURL = async (url: string) => {
		requests.push(url);
		await loadURL(url);
	};
	const reload = window.webContents.reload;
	window.webContents.reload = () => {
		requests.push(window.webContents.getURL());
		reload();
	};
	const state = () => readBookSyncState(JSON.parse(serialized));
	async function fetch(syncDay: string, fullSync = false) {
		const context: BookSyncContext = {
			region: "co.jp",
			outputDirectory: settings.outputDirectory,
			syncDay,
			noteDestinations: settings.noteDestinations,
			fullSync,
		};
		let selected: Book[] = [];
		// A fresh service and a parsed JSON checkpoint model a plugin restart on every run.
		const api = new KindleApiService({} as any);
		(api as any).loggedIn = true;
		(api as any).loginWindow = window;
		const promise = api.fetchHighlights("co.jp", new EventEmitter(), {
			selectBooks: async (books) => {
				selected = selectBooksForSync(books, state(), context);
				serialized = JSON.stringify(beginBookSync(state(), selected, context));
				return selected;
			},
		});
		await vi.runAllTimersAsync();
		const fetched = await promise;
		return { api, context, selected, fetched };
	}
	async function save(run: Awaited<ReturnType<typeof fetch>>) {
		const saved = await saveBookNotes(io, settings, run.fetched.books, run.fetched.highlights);
		serialized = JSON.stringify(finishBookSync(
			state(),
			run.selected,
			run.fetched.books,
			run.api.lastFetchDiagnostics?.failedAnnotations.map((failure) => failure.asin) ?? [],
			saved.outcomes ?? [],
			run.context,
		));
		return { ...run, saved };
	}
	async function sync(syncDay: string, fullSync = false) {
		return save(await fetch(syncDay, fullSync));
	}
	return {
		files, settings, requests, state, fetch, save, sync,
		requestedAsins: () => requests
			.map((url) => new URL(url).searchParams.get("asin"))
			.filter((asin): asin is string => asin !== null),
		select: (asin: string, path: string) => {
			settings.noteDestinations[asin] = { path, ctime: io.identity(), fileId: io.fileIdentity(path) };
		},
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("incremental fetching through notebook parsing and note persistence", () => {
	it("skips completed old books after restart, appends changed annotations once and supports full sync", async () => {
		const remote = { ABC: remoteBook(), OLD: remoteBook("2026-10-02") };
		const v = incrementalSync(remote, { [renamedPath]: source });
		const first = await v.sync("2026-10-12");
		expect(first.saved).toMatchObject({ created: 1, updated: 1, added: 1, held: 0, failed: 0 });
		expect(v.state()["co.jp"].books.ABC).toMatchObject({
			annotationDay: "2026-10-01", fetch: "complete", save: "complete",
		});
		const afterFirst = new Map(v.files);
		v.requests.length = 0;
		const second = await v.sync("2026-10-13");
		expect(second.fetched.books).toEqual([]);
		expect(v.requests).toEqual(["https://read.amazon.co.jp/notebook"]);
		expect(v.files).toEqual(afterFirst);

		remote.ABC.day = "2026-10-14";
		const added = { text: "new remote highlight", location: "20" };
		remote.ABC.annotations.push(added, added);
		v.requests.length = 0;
		const changed = await v.sync("2026-10-14");
		expect(v.requestedAsins()).toEqual(["ABC"]);
		expect(changed.saved).toMatchObject({ added: 1, created: 0, held: 0, failed: 0 });
		const afterChanged = v.files.get(renamedPath)!;
		expect(splitNote(afterChanged).body.startsWith(splitNote(source).body)).toBe(true);
		expect(afterChanged).toContain("> [[Related]] Edited abc ^ref-19495");
		expect(afterChanged.match(/> new remote highlight/g)).toHaveLength(1);
		expect(afterChanged.match(/\^ks-[a-f0-9]{64}/g)).toHaveLength(1);
		expect(v.files.get("books/Book OLD.md")).toBe(afterFirst.get("books/Book OLD.md"));
		expect(v.files.has("books/Book ABC.md")).toBe(false);

		const repeated = await v.sync("2026-10-15");
		expect(repeated.saved.added).toBe(0);
		expect(v.files.get(renamedPath)).toBe(afterChanged);
		v.requests.length = 0;
		const full = await v.sync("2026-10-16", true);
		expect(v.requestedAsins()).toEqual(["ABC", "OLD"]);
		expect(full.saved.added).toBe(0);
		expect(v.files.get(renamedPath)).toBe(afterChanged);
	});

	it("discovers a newly listed old-dated book while skipping completed books", async () => {
		const remote: Record<string, RemoteBook> = { ABC: remoteBook() };
		const v = incrementalSync(remote, { [renamedPath]: source });
		await v.sync("2026-10-12");
		const oldNote = v.files.get(renamedPath);
		remote.NEW = remoteBook("2026-09-01");
		v.requests.length = 0;
		const discovered = await v.sync("2026-10-20");
		expect(v.requests[0]).toBe("https://read.amazon.co.jp/notebook");
		expect(v.requestedAsins()).toEqual(["NEW"]);
		expect(discovered.fetched.books.map((book) => book.asin)).toEqual(["NEW"]);
		expect(discovered.saved).toMatchObject({ created: 1, added: 1, held: 0, failed: 0 });
		expect(v.files.get(renamedPath)).toBe(oldNote);
		expect(v.state()["co.jp"].books.NEW).toMatchObject({
			annotationDay: "2026-09-01", fetch: "complete", save: "complete",
		});
	});

	it("retries a persisted pending fetch after interruption before saving", async () => {
		const v = incrementalSync({ ABC: remoteBook() }, { [renamedPath]: source });
		await v.sync("2026-10-12");
		const interrupted = await v.fetch("2026-10-13", true);
		expect(interrupted.fetched.books.map((book) => book.asin)).toEqual(["ABC"]);
		expect(v.state()["co.jp"].books.ABC).toMatchObject({ fetch: "pending", save: "pending" });
		v.requests.length = 0;
		const resumed = await v.sync("2026-10-20");
		expect(v.requestedAsins()).toEqual(["ABC"]);
		expect(resumed.saved).toMatchObject({ added: 0, created: 0, held: 0, failed: 0 });
		expect(v.state()["co.jp"].books.ABC).toMatchObject({ fetch: "complete", save: "complete" });
		expect(v.files.size).toBe(1);
	});

	it("retries failed fetches and saves with unchanged old dates without duplicating notes", async () => {
		const remote = { FETCH_FAILED: remoteBook(), SAVE_FAILED: remoteBook() };
		remote.FETCH_FAILED.unavailable = true;
		const conflict = "books/Book SAVE_FAILED.md";
		const v = incrementalSync(remote, { [conflict]: "Unrelated personal memo" });
		const failed = await v.sync("2026-10-12");
		expect(failed.fetched.failedBooks).toBe(1);
		expect(failed.saved.failed).toBe(1);
		expect(v.state()["co.jp"].books.FETCH_FAILED).toMatchObject({ fetch: "failed", save: "pending" });
		expect(v.state()["co.jp"].books.SAVE_FAILED).toMatchObject({ fetch: "complete", save: "failed" });
		expect(v.files.get(conflict)).toBe("Unrelated personal memo");
		remote.FETCH_FAILED.unavailable = false;
		v.files.set("books/Personal memo.md", v.files.get(conflict)!);
		v.files.delete(conflict);
		v.requests.length = 0;
		const retried = await v.sync("2026-10-20");
		expect(v.requestedAsins()).toEqual(["FETCH_FAILED", "SAVE_FAILED"]);
		expect(retried.saved).toMatchObject({ created: 2, held: 0, failed: 0 });
		const afterRetry = new Map(v.files);
		await v.sync("2026-10-21");
		expect(v.files).toEqual(afterRetry);
	});

	it("keeps a held duplicate destination eligible and writes only the selected renamed note", async () => {
		const otherPath = "books/Another renamed book.md";
		const otherSource = source.replace("Edited abc", "Other personal edit");
		const remote = { ABC: remoteBook() };
		remote.ABC.annotations.push({ text: "new remote highlight", location: "20" });
		const v = incrementalSync(remote, { [renamedPath]: source, [otherPath]: otherSource });
		const held = await v.sync("2026-10-12");
		expect(held.saved.outcomes).toMatchObject([{ asin: "ABC", status: "held", reason: "destination-unselected" }]);
		expect(v.state()["co.jp"].books.ABC).toMatchObject({ fetch: "complete", save: "held" });
		expect(v.files.get(renamedPath)).toBe(source);
		expect(v.files.get(otherPath)).toBe(otherSource);
		v.select("ABC", renamedPath);
		v.requests.length = 0;
		const selected = await v.sync("2026-10-20");
		expect(v.requestedAsins()).toEqual(["ABC"]);
		expect(selected.saved).toMatchObject({ added: 1, held: 0, failed: 0 });
		const afterSelected = v.files.get(renamedPath)!;
		expect(splitNote(afterSelected).body.startsWith(splitNote(source).body)).toBe(true);
		expect(v.files.get(otherPath)).toBe(otherSource);
		await v.sync("2026-10-21", true);
		expect(v.files.get(renamedPath)).toBe(afterSelected);
		expect(v.files.get(otherPath)).toBe(otherSource);
		expect(v.files.size).toBe(2);
	});

	it("completes note-only books, skips old dates and appends new standalone memos once without replacing edits", async () => {
		const remote: Record<string, RemoteBook> = {
			NOTES: { day: "2026-10-01", annotations: [{ note: "First Kindle memo", location: "10" }] },
		};
		const v = incrementalSync(remote);
		const first = await v.sync("2026-10-12");
		expect(first.fetched.highlights).toMatchObject([{ text: "", note: "First Kindle memo" }]);
		expect(first.api.lastFetchDiagnostics?.annotationCounts).toEqual({
			highlights: 0, standaloneNotes: 1, attachedNotes: 0,
		});
		expect(first.saved).toMatchObject({
			created: 1, added: 1, held: 0, failed: 0,
			addedCounts: { highlights: 0, standaloneNotes: 1, attachedNotes: 0 },
		});
		expect(v.state()["co.jp"].books.NOTES).toMatchObject({
			annotationDay: "2026-10-01", fetch: "complete", save: "complete",
		});
		const path = "books/Book NOTES.md";
		const initial = v.files.get(path)!;
		const originalAnchor = initial.match(/\^ks-[a-f0-9]{64}/)![0];
		v.requests.length = 0;
		const skipped = await v.sync("2026-10-13");
		expect(skipped.fetched.books).toEqual([]);
		expect(v.requests).toEqual(["https://read.amazon.co.jp/notebook"]);
		expect(v.files.get(path)).toBe(initial);

		const renamed = "books/Renamed note-only book.md";
		const edited = initial.replace("> First Kindle memo", "> [[Related]] My edited memo") +
			"\nPersonal memo [[Other]]\n";
		v.files.set(renamed, edited);
		v.files.delete(path);
		remote.NOTES.day = "2026-10-14";
		const newMemo = { note: "Second Kindle memo", location: "20" };
		remote.NOTES.annotations.push(newMemo, newMemo);
		v.requests.length = 0;
		const changed = await v.sync("2026-10-14");
		expect(v.requestedAsins()).toEqual(["NOTES"]);
		expect(changed.fetched.highlights.every((annotation) => annotation.text === "")).toBe(true);
		expect(changed.saved).toMatchObject({
			created: 0, added: 1, held: 0, failed: 0,
			addedCounts: { highlights: 0, standaloneNotes: 1, attachedNotes: 0 },
		});
		const afterChanged = v.files.get(renamed)!;
		const userBody = (content: string) => splitNote(content).body
			.replace(/<!-- kindle-sync:v1 [^\r\n]* -->/g, "");
		expect(userBody(afterChanged).startsWith(userBody(edited))).toBe(true);
		expect(afterChanged).toContain("> [[Related]] My edited memo");
		expect(afterChanged).toContain("\nPersonal memo [[Other]]\n");
		expect(afterChanged).toContain(originalAnchor);
		expect(afterChanged.match(/> Second Kindle memo/g)).toHaveLength(1);
		expect(afterChanged.match(/\^ks-[a-f0-9]{64}/g)).toHaveLength(2);
		v.requests.length = 0;
		const repeated = await v.sync("2026-10-15", true);
		expect(v.requestedAsins()).toEqual(["NOTES"]);
		expect(repeated.saved).toMatchObject({
			added: 0, held: 0, failed: 0,
			addedCounts: { highlights: 0, standaloneNotes: 0, attachedNotes: 0 },
		});
		expect(v.files.get(renamed)).toBe(afterChanged);
		expect(v.files.size).toBe(1);
		expect(v.state()["co.jp"].books.NOTES).toMatchObject({ fetch: "complete", save: "complete" });
	});

	it("keeps a valid empty fetch pending until annotations are actually saved", async () => {
		const remote = { EMPTY: remoteBook() };
		remote.EMPTY.annotations = [];
		const v = incrementalSync(remote);
		const empty = await v.sync("2026-10-12");
		expect(empty.saved.outcomes).toEqual([{ asin: "EMPTY", status: "skipped-no-highlights" }]);
		expect(v.state()["co.jp"].books.EMPTY).toMatchObject({ fetch: "complete", save: "pending" });
		expect(v.files.size).toBe(0);
		remote.EMPTY.annotations.push(original);
		v.requests.length = 0;
		const later = await v.sync("2026-10-20");
		expect(v.requestedAsins()).toEqual(["EMPTY"]);
		expect(later.saved.created).toBe(1);
		expect(v.state()["co.jp"].books.EMPTY).toMatchObject({ fetch: "complete", save: "complete" });
	});
});
