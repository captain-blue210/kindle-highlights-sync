import type { Book } from "../models";
import type { NoteDestinations } from "./note-destination";
import type { NoteSaveOutcome } from "./note-writer";

export interface BookSyncCheckpoint {
	annotationDay: string | null;
	fetch: "pending" | "complete" | "failed";
	save: "pending" | "complete" | "held" | "failed";
	outputDirectory: string;
	destination?: string;
}
export interface RegionSyncState {
	lastSyncDay?: string;
	books: Record<string, BookSyncCheckpoint>;
}
export type BookSyncState = Record<string, RegionSyncState>;
export interface BookSyncContext {
	region: string;
	outputDirectory: string;
	syncDay: string;
	noteDestinations: NoteDestinations;
	fullSync?: boolean;
}
function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function validDay(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function annotationDay(book: Book): string | null {
	const date = book.lastAnnotatedDate;
	return date instanceof Date && Number.isFinite(date.getTime())
		? date.toISOString().slice(0, 10) : null;
}
/** Device calendar day; Amazon's parsed dates are UTC encodings of calendar days. */
export function localSyncDay(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function previousDay(day: string): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() - 1);
	return date.toISOString().slice(0, 10);
}
function destinationSignature(context: BookSyncContext, asin: string): string | undefined {
	const selection = context.noteDestinations[asin];
	return selection ? JSON.stringify([selection.path, selection.ctime, selection.fileId, selection.invalidated]) : undefined;
}

/** Malformed completion records are discarded so they cannot suppress retrieval. */
export function readBookSyncState(value: unknown): BookSyncState {
	const result: BookSyncState = Object.create(null);
	if (!record(value)) return result;
	for (const [region, raw] of Object.entries(value)) {
		if (!record(raw) || !record(raw.books)) continue;
		const books: RegionSyncState["books"] = Object.create(null);
		for (const [asin, entry] of Object.entries(raw.books)) {
			if (!record(entry) || !(entry.annotationDay === null || validDay(entry.annotationDay)) ||
				!["pending", "complete", "failed"].includes(String(entry.fetch)) ||
				!["pending", "complete", "held", "failed"].includes(String(entry.save)) ||
				typeof entry.outputDirectory !== "string" ||
				(entry.destination !== undefined && typeof entry.destination !== "string")) continue;
			books[asin] = {
				annotationDay: entry.annotationDay as string | null,
				fetch: entry.fetch as BookSyncCheckpoint["fetch"],
				save: entry.save as BookSyncCheckpoint["save"],
				outputDirectory: entry.outputDirectory,
				...(entry.destination === undefined ? {} : { destination: entry.destination as string }),
			};
		}
		result[region] = { books, ...(validDay(raw.lastSyncDay) ? { lastSyncDay: raw.lastSyncDay } : {}) };
	}
	return result;
}

export function selectBooksForSync(books: Book[], state: BookSyncState, context: BookSyncContext): Book[] {
	const region = state[context.region];
	const lastDay = region?.lastSyncDay;
	const cutoff = validDay(lastDay) && lastDay <= context.syncDay ? previousDay(lastDay) : undefined;
	return books.filter(book => {
		const checkpoint = region?.books[book.asin];
		const day = annotationDay(book);
		return context.fullSync || !cutoff || !checkpoint ||
			checkpoint.fetch !== "complete" || checkpoint.save !== "complete" ||
			!day || day !== checkpoint.annotationDay || day >= cutoff ||
			checkpoint.outputDirectory !== context.outputDirectory ||
			checkpoint.destination !== destinationSignature(context, book.asin) ||
			!!context.noteDestinations[book.asin]?.invalidated;
	});
}

/** Persist this state before issuing requests, including same-date recent refetches. */
export function beginBookSync(state: BookSyncState, books: Book[], context: BookSyncContext): BookSyncState {
	const next = readBookSyncState(state);
	const region = next[context.region] ??= { books: Object.create(null) };
	for (const book of books) region.books[book.asin] = {
		annotationDay: annotationDay(book), fetch: "pending", save: "pending",
		outputDirectory: context.outputDirectory,
		...(destinationSignature(context, book.asin) === undefined ? {} : { destination: destinationSignature(context, book.asin) }),
	};
	return next;
}

export function finishBookSync(state: BookSyncState, selected: Book[], fetched: Book[], failed: string[], outcomes: NoteSaveOutcome[], context: BookSyncContext): BookSyncState {
	const next = beginBookSync(state, selected, context);
	const region = next[context.region];
	const fetchedAsins = new Set(fetched.map(book => book.asin));
	const failedAsins = new Set(failed);
	const saved = new Map(outcomes.map(outcome => [outcome.asin, outcome.status]));
	for (const book of selected) {
		const checkpoint = region.books[book.asin];
		if (failedAsins.has(book.asin)) checkpoint.fetch = "failed";
		else if (fetchedAsins.has(book.asin)) {
			checkpoint.fetch = "complete";
			const status = saved.get(book.asin);
			if (status === "created" || status === "updated") checkpoint.save = "complete";
			else if (status === "held" || status === "failed") checkpoint.save = status;
			// An empty parse with no note written is fetch-only. Keep retrying it.
		}
	}
	region.lastSyncDay = context.syncDay;
	return next;
}
