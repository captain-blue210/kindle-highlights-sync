import { EventEmitter } from "events";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({ Notice: vi.fn() }));
import { KindleApiService } from "./kindle-api";
import { saveBookNotes } from "./note-writer";
import { DEFAULT_PROPERTY_NAMES, splitNote } from "./note-properties";
import { libraryHtml, notebookWindow } from "../test-utils/notebook-window";

afterEach(() => vi.useRealTimers());

it("fetches and saves an ASIN arriving after five seconds, retaining an edited note on two syncs", async () => {
	vi.useFakeTimers();
	const start = Date.now();
	const window = notebookWindow((url) => {
		if (!url.includes("asin="))
			return libraryHtml(
				Date.now() - start < 8000 ? ["ABC"] : ["ABC", "B0BJZNNS6W"],
				Date.now() - start >= 8000,
			);
		return `<input class="kp-notebook-content-limit-state" value=""><input class="kp-notebook-annotations-next-page-start" value=""><div class="a-row a-spacing-base"><span id="highlight">abc</span><input id="kp-annotation-location" value="10"></div>`;
	});
	const api = new KindleApiService({} as any);
	(api as any).loggedIn = true;
	(api as any).loginWindow = window;
	const source =
		'---\nbookId: "saved"\ntitle: Original\nASIN: ABC\n---\n\n> [[Related]] Edited abc ^ref-19495\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\nPersonal memo\n';
	const files = new Map([["books/Renamed.md", source]]);
	const io = {
		list: () => [...files.keys()],
		read: async (path: string) => files.get(path)!,
		create: async (path: string, content: string) => {
			files.set(path, content);
		},
		process: async (path: string, fn: (content: string) => string) => {
			files.set(path, fn(files.get(path)!));
		},
	};
	const config = {
		outputDirectory: "books",
		templateContent: "# {{title}}\n\n{{highlights}}\n",
		propertyNames: DEFAULT_PROPERTY_NAMES,
		propertyNameHistory: [],
	};
	const pending = api.fetchHighlights("co.jp", new EventEmitter());
	await vi.advanceTimersByTimeAsync(20000);
	const firstFetch = await pending;
	expect(firstFetch.books.map((book) => book.asin)).toEqual([
		"ABC",
		"B0BJZNNS6W",
	]);
	expect(api.lastFetchDiagnostics).toMatchObject({
		library: { status: "complete" },
		fetchedAsins: ["ABC", "B0BJZNNS6W"],
		failedAnnotations: [],
	});
	const firstSave = await saveBookNotes(
		io,
		config,
		firstFetch.books,
		firstFetch.highlights,
	);
	expect(firstSave.created).toBe(1);
	expect(firstSave.outcomes).toMatchObject([
		{ asin: "ABC", status: "updated", path: "books/Renamed.md" },
		{ asin: "B0BJZNNS6W", status: "created" },
	]);
	const afterFirst = new Map(files);
	const secondPending = api.fetchHighlights("co.jp", new EventEmitter());
	await vi.advanceTimersByTimeAsync(15000);
	const secondFetch = await secondPending;
	const secondSave = await saveBookNotes(
		io,
		config,
		secondFetch.books,
		secondFetch.highlights,
	);
	expect(secondSave.added).toBe(0);
	expect(secondSave.created).toBe(0);
	expect(files).toEqual(afterFirst);
	expect(
		splitNote(files.get("books/Renamed.md")!).body.startsWith(
			splitNote(source).body,
		),
	).toBe(true);
});
