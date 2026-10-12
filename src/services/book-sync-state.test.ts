import { describe, expect, it } from "vitest";
import type { Book } from "../models";
import {
	beginBookSync,
	finishBookSync,
	localSyncDay,
	readBookSyncState,
	selectBooksForSync,
	type BookSyncState,
} from "./book-sync-state";

const book = (asin: string, day: string | null = "2026-10-01"): Book => ({
	id: asin, asin, title: asin,
	lastAnnotatedDate: day ? new Date(`${day}T00:00:00Z`) : null,
});
const context = { region: "co.jp", outputDirectory: "books", syncDay: "2026-10-12", noteDestinations: {} };
const complete = (annotationDay = "2026-10-01") => ({
	annotationDay, fetch: "complete" as const, save: "complete" as const,
	outputDirectory: "books",
});
const state = (books: BookSyncState[string]["books"]): BookSyncState => ({
	"co.jp": { lastSyncDay: "2026-10-12", books },
});
const selected = (books: Book[], prior: BookSyncState, options = {}) =>
	selectBooksForSync(books, prior, { ...context, ...options }).map(b => b.asin);

describe("incremental book selection", () => {
	it("captures the device's calendar day instead of formatting UTC", () => {
		expect(localSyncDay(new Date(2026, 9, 12, 0, 5))).toBe("2026-10-12");
	});
	it("skips only old books whose annotation fetch and save both completed", () => {
		expect(selected([book("OLD"), book("NEW")], state({ OLD: complete() }))).toEqual(["NEW"]);
	});
	it("includes changed dates in either direction, invalid dates and unknown dates", () => {
		const books = [book("FORWARD", "2026-10-02"), book("BACKWARD", "2026-09-30"), book("UNKNOWN", null), book("INVALID")];
		books[3].lastAnnotatedDate = new Date("invalid");
		expect(selected(books, state(Object.fromEntries(books.map(b => [b.asin, complete()]))))).toEqual(books.map(b => b.asin));
	});
	it("includes the previous sync day's preceding calendar day inclusively", () => {
		const books = [book("OLD", "2026-10-10"), book("YESTERDAY", "2026-10-11"), book("SAME_DAY", "2026-10-12")];
		expect(selected(books, state(Object.fromEntries(books.map(b => [b.asin, complete(b.lastAnnotatedDate!.toISOString().slice(0, 10))]))))).toEqual(["YESTERDAY", "SAME_DAY"]);
	});
	it("subtracts a civil day across a year boundary", () => {
		const prior = state({ DEC30: complete("2025-12-30"), DEC31: complete("2025-12-31") });
		prior["co.jp"].lastSyncDay = "2026-01-01";
		expect(selected([book("DEC30", "2025-12-30"), book("DEC31", "2025-12-31")], prior)).toEqual(["DEC31"]);
	});
	it.each([
		{ fetch: "failed" as const }, { fetch: "pending" as const },
		{ save: "held" as const }, { save: "failed" as const }, { save: "pending" as const },
	])("retries incomplete state %j even with an unchanged old date", incomplete => {
		expect(selected([book("OLD")], state({ OLD: { ...complete(), ...incomplete } }))).toEqual(["OLD"]);
	});
	it("isolates regions, forces full sync and retries changed output directories", () => {
		const prior = state({ OLD: complete() });
		expect(selected([book("OLD")], prior, { region: "com" })).toEqual(["OLD"]);
		expect(selected([book("OLD")], prior, { fullSync: true })).toEqual(["OLD"]);
		expect(selected([book("OLD")], prior, { outputDirectory: "new-books" })).toEqual(["OLD"]);
	});
	it("retries changed or invalidated explicit destinations", () => {
		const prior = state({ OLD: complete() });
		expect(selected([book("OLD")], prior, { noteDestinations: { OLD: { path: "books/renamed.md", ctime: 1, fileId: "inode" } } })).toEqual(["OLD"]);
		prior["co.jp"].books.OLD.destination = JSON.stringify(["books/a.md", 1, "inode", "renamed"]);
		expect(selected([book("OLD")], prior, { noteDestinations: { OLD: { path: "books/a.md", ctime: 1, fileId: "inode", invalidated: "renamed" } } })).toEqual(["OLD"]);
	});
	it("refetches when the previous sync calendar day is unavailable or in the future", () => {
		const prior = state({ OLD: complete() });
		delete prior["co.jp"].lastSyncDay;
		expect(selected([book("OLD")], prior)).toEqual(["OLD"]);
		prior["co.jp"].lastSyncDay = "2026-10-13";
		expect(selected([book("OLD")], prior)).toEqual(["OLD"]);
	});
});

describe("durable book completion", () => {
	it("marks selected books pending before fetching without changing old state", () => {
		const prior = state({ OLD: complete(), SKIPPED: complete() });
		const pending = beginBookSync(prior, [book("OLD")], context);
		expect(pending["co.jp"].books.OLD).toMatchObject({ fetch: "pending", save: "pending" });
		expect(prior["co.jp"].books.OLD).toEqual(complete());
		expect(pending["co.jp"].books.SKIPPED).toEqual(complete());
		expect(selected([book("OLD")], JSON.parse(JSON.stringify(pending)))).toEqual(["OLD"]);
	});
	it("completes only fetched and saved books; fetch failures and holds remain eligible", () => {
		const books = [book("SAVED"), book("FETCH_FAILED"), book("SAVE_FAILED"), book("HELD"), book("FETCH_ONLY")];
		const pending = beginBookSync({}, books, context);
		const next = finishBookSync(pending, books, books.filter(b => b.asin !== "FETCH_FAILED"), ["FETCH_FAILED"], [
			{ asin: "SAVED", status: "updated" }, { asin: "SAVE_FAILED", status: "failed" },
			{ asin: "HELD", status: "held" },
		], context);
		expect(next["co.jp"].books.SAVED).toMatchObject({ fetch: "complete", save: "complete" });
		expect(next["co.jp"].books.FETCH_FAILED).toMatchObject({ fetch: "failed", save: "pending" });
		expect(next["co.jp"].books.HELD).toMatchObject({ fetch: "complete", save: "held" });
		expect(selected(books, readBookSyncState(JSON.parse(JSON.stringify(next))))).toEqual(["FETCH_FAILED", "SAVE_FAILED", "HELD", "FETCH_ONLY"]);
	});
	it("keeps books with no saved annotations eligible", () => {
		const books = [book("EMPTY")];
		const next = finishBookSync(beginBookSync({}, books, context), books, books, [], [{ asin: "EMPTY", status: "skipped-no-highlights" }], context);
		expect(selected(books, next)).toEqual(["EMPTY"]);
	});
	it("does not trust malformed persisted completion or calendar days", () => {
		const malformed = { "co.jp": { lastSyncDay: "2026-02-30", books: { OLD: { ...complete(), fetch: "unknown" }, INVALID_DAY: complete("2026-02-30") } } };
		const read = readBookSyncState(malformed);
		expect(read["co.jp"].lastSyncDay).toBeUndefined();
		expect(read["co.jp"].books).toEqual({});
		expect(readBookSyncState([])).toEqual({});
	});
});
