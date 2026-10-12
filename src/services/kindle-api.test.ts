import { EventEmitter } from "events";
import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
vi.mock("obsidian", () => ({ Notice: vi.fn() }));
vi.mock("../utils/remote-loader", () => ({ loadRemoteDom: vi.fn() }));
import { loadRemoteDom } from "../utils/remote-loader";
import { Notice } from "obsidian";
import { KindleApiService } from "./kindle-api";
import { Book } from "../models";
const notebook = () =>
	'<div id="kp-notebook-library">' +
	Array.from(
		{ length: 12 },
		(_, i) =>
			`<div class="kp-notebook-library-each-book" id="ASIN${i}"><h2 class="kp-notebook-searchable">Book ${i}</h2><input id="kp-notebook-annotated-date-${i}" value="Thursday, October 8, 2026"></div>`,
	).join("") +
	"</div>";
describe("Kindle fetching completeness", () => {
	it("fetches every listed book and excludes failed books from note updates", async () => {
		vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
			if (url.includes("asin=ASIN2&")) throw Error("Network failed");
			const html = url.includes("?")
				? '<div id="kp-notebook-annotations"><div class="a-row a-spacing-base"><span id="highlight">abc</span><input id="kp-annotation-location" value="10"></div></div>'
				: notebook();
			return {
				dom: cheerio.load(html) as unknown as cheerio.CheerioAPI,
				html,
				finalUrl: url,
				library: { status: "complete", snapshots: [] },
			};
		});
		const api = new KindleApiService({} as any);
		(api as any).loggedIn = true;
		(api as any).loginWindow = { isDestroyed: () => false };
		const result = await api.fetchHighlights("co.jp", new EventEmitter());
		expect(result.books).toHaveLength(11);
		expect(result.books.some((b) => b.asin === "ASIN11")).toBe(true);
		expect(result.books.some((b) => b.asin === "ASIN2")).toBe(false);
		expect(result.highlights).toHaveLength(11);
		expect(result.books[0].lastAnnotatedDate?.toISOString()).toBe(
			"2026-10-08T00:00:00.000Z",
		);
	});
	it("rejects an expired session redirect instead of treating it as an empty library", async () => {
		vi.mocked(loadRemoteDom).mockResolvedValue({
			dom: cheerio.load(
				'<form id="ap_signin_form"></form>',
			) as unknown as cheerio.CheerioAPI,
			html: '<form id="ap_signin_form"></form>',
			finalUrl: "https://www.amazon.co.jp/ap/signin",
		});
		const api = new KindleApiService({} as any);
		(api as any).loggedIn = true;
		(api as any).loginWindow = { isDestroyed: () => false };
		await expect(
			api.fetchHighlights("co.jp", new EventEmitter()),
		).rejects.toThrow();
	});
});

const fragment = (text = "") =>
	'<input class="kp-notebook-content-limit-state" value="">' +
	'<input class="kp-notebook-annotations-next-page-start" value="">' +
	(text
		? `<div class="a-row a-spacing-base"><span id="highlight">${text}</span><input id="kp-annotation-location" value="10"></div>`
		: "");
const oneBook =
	'<div id="kp-notebook-library"><div class="kp-notebook-library-each-book" id="ASIN0"><h2 class="kp-notebook-searchable">Book</h2></div></div>';
function readyApi() {
	const api = new KindleApiService({} as any);
	(api as any).loggedIn = true;
	(api as any).loginWindow = { isDestroyed: () => false };
	return api;
}
it("accepts genuine annotation fragments including an empty final page", async () => {
	vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
		let html = oneBook;
		if (url.includes("asin="))
			html = url.includes("token=next")
				? fragment()
				: fragment("abc").replace(
						'annotations-next-page-start" value=""',
						'annotations-next-page-start" value="next"',
					);
		return {
			dom: cheerio.load(html) as unknown as cheerio.CheerioAPI,
			html,
			finalUrl: url,
			library: { status: "complete", snapshots: [] },
		};
	});
	const result = await readyApi().fetchHighlights(
		"co.jp",
		new EventEmitter(),
	);
	expect(result.failedBooks).toBe(0);
	expect(result.books).toHaveLength(1);
	expect(result.highlights.map((h) => h.text)).toEqual(["abc"]);
	expect(
		vi
			.mocked(loadRemoteDom)
			.mock.calls.some(([url]) => url.includes("token=next")),
	).toBe(true);
});
it.each(["unknown", "login", "wrong-book"])(
	"holds an invalid annotation response: %s",
	async (kind) => {
		vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
			const html = url.includes("asin=")
				? kind === "unknown"
					? "<p>Unavailable</p>"
					: fragment("abc") +
						(kind === "login"
							? '<form name="signIn"><input id="ap_password"></form>'
							: "")
				: oneBook;
			return {
				dom: cheerio.load(html) as unknown as cheerio.CheerioAPI,
				html,
				finalUrl:
					kind === "wrong-book"
						? url.replace("asin=ASIN0", "asin=OTHER")
						: url,
				library: { status: "complete", snapshots: [] },
			};
		});
		const result = await readyApi().fetchHighlights(
			"co.jp",
			new EventEmitter(),
		);
		expect(result.failedBooks).toBe(1);
		expect(result.books).toHaveLength(0);
		expect(result.highlights).toHaveLength(0);
	},
);

it("records listed ASINs, excluded rows and annotation failures as different stages", async () => {
	const html = oneBook.replace(
		"</div></div>",
		'</div><div class="kp-notebook-library-each-book" id="NO_TITLE"></div><div class="kp-notebook-library-each-book" id="FAILED"><h2 class="kp-notebook-searchable">Failed book</h2></div></div>',
	);
	vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
		if (url.includes("asin=FAILED")) throw Error("NETWORK SECRET_COOKIE");
		const content = url.includes("asin=") ? fragment("abc") : html;
		return {
			dom: cheerio.load(content) as unknown as cheerio.CheerioAPI,
			html: content,
			finalUrl: url,
			library: { status: "complete", snapshots: [] },
		};
	});
	const api = readyApi();
	const result = await api.fetchHighlights("co.jp", new EventEmitter());
	expect(api.lastFetchDiagnostics).toMatchObject({
		notebookAsins: ["ASIN0", "NO_TITLE", "FAILED"],
		parsedAsins: ["ASIN0", "FAILED"],
		fetchedAsins: ["ASIN0"],
		excludedRows: [{ row: 2, asin: "NO_TITLE", reason: "missing-title" }],
		failedAnnotations: [
			{ asin: "FAILED", reason: "annotation-fetch-failed" },
		],
	});
	expect(result.failedBooks).toBe(1);
	expect(result.books.map((b) => b.asin)).toEqual(["ASIN0"]);
	expect(JSON.stringify(api.lastFetchDiagnostics)).not.toContain(
		"SECRET_COOKIE",
	);
});

it.each(["unconfirmed", "load-failed"] as const)(
	"does not fetch annotations from a %s library",
	async (status) => {
		const visited: string[] = [];
		vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
			visited.push(url);
			return {
				dom: cheerio.load(oneBook) as unknown as cheerio.CheerioAPI,
				html: oneBook,
				finalUrl: url,
				library: { status, snapshots: [] },
			};
		});
		const api = readyApi();
		await expect(
			api.fetchHighlights("co.jp", new EventEmitter()),
		).rejects.toThrow();
		expect(visited).toEqual(["https://read.amazon.co.jp/notebook"]);
		expect(api.lastFetchDiagnostics).toMatchObject({
			library: { status },
			notebookAsins: ["ASIN0"],
			fetchedAsins: [],
		});
	},
);

it("records a navigation failure as loading failed instead of an unconfirmed end", async () => {
	vi.mocked(loadRemoteDom).mockRejectedValue(
		Error("Notebook navigation failed"),
	);
	const api = readyApi();
	await expect(
		api.fetchHighlights("co.jp", new EventEmitter()),
	).rejects.toThrow();
	expect(api.lastFetchDiagnostics?.library.status).toBe("load-failed");
	expect(api.lastFetchDiagnostics?.finishedAt).toBeDefined();
});

it("settles each fetched book once and preserves a safe page failure reason", async () => {
	vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
		if (url.includes("asin=ASIN2&"))
			throw Error("Notebook navigation timed out");
		const html = url.includes("?") ? fragment("abc") : notebook();
		return {
			dom: cheerio.load(html) as unknown as cheerio.CheerioAPI,
			html,
			finalUrl: url,
			library: { status: "complete", snapshots: [] },
		};
	});
	const emitter = new EventEmitter();
	const settled: any[] = [];
	emitter.on("fetch:book:settled", (event) => settled.push(event));
	await readyApi().fetchHighlights("co.jp", emitter);
	expect(settled).toHaveLength(12);
	expect(settled.filter((e) => e.status === "success")).toHaveLength(11);
	expect(settled[2]).toMatchObject({
		status: "failed",
		bookTitle: "Book 2",
		error: "Notebook navigation timed out",
	});
});

it("leaves failure notices to the synchronization UI", async () => {
	vi.mocked(Notice).mockClear();
	const api = new KindleApiService({} as any);
	await expect(
		api.fetchHighlights("co.jp", new EventEmitter()),
	).rejects.toThrow();
	expect(Notice).not.toHaveBeenCalled();
});

it("reports mixed annotation counts consistently from page events through fetch diagnostics", async()=>{
 const list='<div id="kp-notebook-library"><div class="kp-notebook-library-each-book" id="ABC"><h2 class="kp-notebook-searchable">Book</h2></div></div>';
 const page='<input class="kp-notebook-content-limit-state" value=""><input class="kp-notebook-annotations-next-page-start" value=""><div class="a-row a-spacing-base"><span id="highlight">abc</span><span id="note">attached</span><input id="kp-annotation-location" value="10"></div><div class="a-row a-spacing-base"><span id="note">standalone</span><input id="kp-annotation-location" value="20"></div>';
 vi.mocked(loadRemoteDom).mockImplementation(async url=>({dom:cheerio.load(url.includes('?')?page:list) as any,html:url.includes('?')?page:list,finalUrl:url,library:{status:'complete',snapshots:[]}}));
 const api=new KindleApiService({} as any);(api as any).loggedIn=true;(api as any).loginWindow={isDestroyed:()=>false};
 const emitter=new EventEmitter();let pageEnd:any,bookEnd:any;emitter.on('fetch:page:end',e=>pageEnd=e);emitter.on('fetch:highlights:end',e=>bookEnd=e);
 const result=await api.fetchHighlights('co.jp',emitter);
 expect(result.highlights).toHaveLength(3);
 expect(pageEnd.highlightsFound).toBe(1);
 expect(pageEnd.annotationCounts).toEqual({highlights:1,standaloneNotes:1,attachedNotes:1});
 expect(bookEnd.highlightCount).toBe(1);
 expect(api.lastFetchDiagnostics?.annotationCounts).toEqual({highlights:1,standaloneNotes:1,attachedNotes:1});
});

describe("Kindle annotation selection", () => {
	const notebookUrl = "https://read.amazon.co.jp/notebook";
	const selectedNotebook =
		'<div id="kp-notebook-library">' +
		[0, 1, 2]
			.map(
				(index) =>
					`<div class="kp-notebook-library-each-book" id="ASIN${index}"><h2 class="kp-notebook-searchable">Book ${index}</h2></div>`,
			)
			.join("") +
		"</div>";
	const annotationUrl = (asin: string) =>
		`${notebookUrl}?asin=${asin}&contentLimitState=&token=`;

	function serveNotebookAndAnnotations(failedAsin?: string) {
		const visited: string[] = [];
		vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
			visited.push(url);
			if (failedAsin && url === annotationUrl(failedAsin))
				throw Error("Notebook navigation timed out");
			const html = url === notebookUrl
				? selectedNotebook
				: fragment("Selected highlight");
			return {
				dom: cheerio.load(html) as unknown as cheerio.CheerioAPI,
				html,
				finalUrl: url,
				library: { status: "complete", snapshots: [] },
			};
		});
		return visited;
	}

	it("requests annotations only for selected books and reports the full library size", async () => {
		const visited = serveNotebookAndAnnotations();
		const api = readyApi();
		const emitter = new EventEmitter();
		const bookLists: unknown[] = [];
		emitter.on("fetch:booklist:end", (event) => bookLists.push(event));
		const result = await api.fetchHighlights("co.jp", emitter, {
			selectBooks: async (books: Book[]) =>
				books.filter((book) => book.asin === "ASIN1"),
		});

		expect(visited).toEqual([notebookUrl, annotationUrl("ASIN1")]);
		expect(result.books.map((book) => book.asin)).toEqual(["ASIN1"]);
		expect(result.highlights.map((highlight) => highlight.bookId)).toEqual([
			"ASIN1",
		]);
		expect(result.failedBooks).toBe(0);
		expect(result.skippedBooks).toBe(2);
		expect(bookLists).toEqual([
			{ totalBooks: 3, selectedBooks: 1, skippedBooks: 2, excludedRows: [] },
		]);
		expect(api.lastFetchDiagnostics).toMatchObject({
			parsedAsins: ["ASIN0", "ASIN1", "ASIN2"],
			selectedAsins: ["ASIN1"],
			skippedAsins: ["ASIN0", "ASIN2"],
			fetchedAsins: ["ASIN1"],
		});
	});

	it("refreshes and parses the full notebook before selection on every call", async () => {
		const visited: string[] = [];
		vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
			visited.push(url);
			const html = visited.length === 1 ? oneBook : selectedNotebook;
			return {
				dom: cheerio.load(html) as unknown as cheerio.CheerioAPI,
				html,
				finalUrl: url,
				library: { status: "complete", snapshots: [] },
			};
		});
		const api = readyApi();
		const selectedFrom: string[][] = [];
		const options = {
			selectBooks: async (books: Book[]) => {
				selectedFrom.push(books.map((book) => book.asin));
				return [];
			},
		};
		await api.fetchHighlights("co.jp", new EventEmitter(), options);
		await api.fetchHighlights("co.jp", new EventEmitter(), options);

		expect(visited).toEqual([notebookUrl, notebookUrl]);
		expect(selectedFrom).toEqual([
			["ASIN0"],
			["ASIN0", "ASIN1", "ASIN2"],
		]);
	});

	it("makes no annotation requests when selection is empty", async () => {
		const visited = serveNotebookAndAnnotations();
		const api = readyApi();
		const result = await api.fetchHighlights("co.jp", new EventEmitter(), {
			selectBooks: async () => [],
		});

		expect(visited).toEqual([notebookUrl]);
		expect(result).toEqual({ books: [], highlights: [], failedBooks: 0, skippedBooks: 3 });
		expect(api.lastFetchDiagnostics).toMatchObject({
			selectedAsins: [],
			skippedAsins: ["ASIN0", "ASIN1", "ASIN2"],
			fetchedAsins: [],
			failedAnnotations: [],
		});
	});

	it.each(["unconfirmed", "load-failed"] as const)(
		"rejects a %s library before invoking selection",
		async (status) => {
			const visited: string[] = [];
			vi.mocked(loadRemoteDom).mockImplementation(async (url) => {
				visited.push(url);
				return {
					dom: cheerio.load(selectedNotebook) as unknown as cheerio.CheerioAPI,
					html: selectedNotebook,
					finalUrl: url,
					library: { status, snapshots: [] },
				};
			});
			let selectionInvoked = false;
			await expect(
				readyApi().fetchHighlights("co.jp", new EventEmitter(), {
					selectBooks: async (books: Book[]) => {
						selectionInvoked = true;
						return books;
					},
				}),
			).rejects.toThrow(status === "load-failed"
				? "Notebook library loading failed"
				: "Notebook library range unconfirmed");
			expect(selectionInvoked).toBe(false);
			expect(visited).toEqual([notebookUrl]);
		},
	);

	it("waits for asynchronous selection before requesting any annotations", async () => {
		const visited = serveNotebookAndAnnotations();
		let releaseSelection!: (books: Book[]) => void;
		const selection = new Promise<Book[]>((resolve) => { releaseSelection = resolve; });
		let selectedBooks: Book[] = [];
		const fetching = readyApi().fetchHighlights("co.jp", new EventEmitter(), {
			selectBooks: (books: Book[]) => {
				selectedBooks = books.filter((book) => book.asin === "ASIN2");
				return selection;
			},
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		const visitedBeforeSelectionFinished = [...visited];
		releaseSelection(selectedBooks);
		const result = await fetching;

		expect(visitedBeforeSelectionFinished).toEqual([notebookUrl]);
		expect(visited).toEqual([notebookUrl, annotationUrl("ASIN2")]);
		expect(result.books.map((book) => book.asin)).toEqual(["ASIN2"]);
	});

	it("aborts without annotation requests when selection rejects", async () => {
		const visited = serveNotebookAndAnnotations();
		const selectionError = Error("Selection unavailable");
		await expect(
			readyApi().fetchHighlights("co.jp", new EventEmitter(), {
				selectBooks: async () => { throw selectionError; },
			}),
		).rejects.toBe(selectionError);
		expect(visited).toEqual([notebookUrl]);
	});

	it("counts only failed selected books as failures", async () => {
		const visited = serveNotebookAndAnnotations("ASIN2");
		const api = readyApi();
		const result = await api.fetchHighlights("co.jp", new EventEmitter(), {
			selectBooks: async (books: Book[]) =>
				books.filter((book) => book.asin !== "ASIN1"),
		});

		expect(visited).toEqual([notebookUrl, annotationUrl("ASIN0"), annotationUrl("ASIN2")]);
		expect(result.books.map((book) => book.asin)).toEqual(["ASIN0"]);
		expect(result.failedBooks).toBe(1);
		expect(result.skippedBooks).toBe(1);
		expect(api.lastFetchDiagnostics).toMatchObject({
			selectedAsins: ["ASIN0", "ASIN2"],
			skippedAsins: ["ASIN1"],
			failedAnnotations: [{ asin: "ASIN2", reason: "annotation-fetch-failed" }],
		});
	});

	it("selects the entire notebook by default and always reports selection diagnostics", async () => {
		const visited = serveNotebookAndAnnotations();
		const api = readyApi();
		const result = await api.fetchHighlights("co.jp", new EventEmitter());

		expect(visited).toEqual([
			notebookUrl,
			annotationUrl("ASIN0"),
			annotationUrl("ASIN1"),
			annotationUrl("ASIN2"),
		]);
		expect(result.books).toHaveLength(3);
		expect(result.skippedBooks).toBe(0);
		expect(api.lastFetchDiagnostics).toMatchObject({
			selectedAsins: ["ASIN0", "ASIN1", "ASIN2"],
			skippedAsins: [],
		});
	});
});
