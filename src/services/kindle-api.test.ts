import { EventEmitter } from "events";
import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
vi.mock("obsidian", () => ({ Notice: vi.fn() }));
vi.mock("../utils/remote-loader", () => ({ loadRemoteDom: vi.fn() }));
import { loadRemoteDom } from "../utils/remote-loader";
import { KindleApiService } from "./kindle-api";
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
