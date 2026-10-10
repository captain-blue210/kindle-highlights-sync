import { describe, it, expect, vi, afterEach } from "vitest";
import {
	SyncProgressTracker,
	safeErrorMessage,
	readErrorRecord,
} from "./sync-progress";

describe("book progress", () => {
	it("keeps unknown totals indeterminate and resets counts between phases", () => {
		const tracker = new SyncProgressTracker(true);
		expect(tracker.state.counts.total).toBeNull();
		tracker.startPhase("fetch", 3);
		tracker.startBook("A very long book title");
		expect(tracker.state.currentBook).toBe("A very long book title");
		expect(tracker.state.counts.completed).toBe(0);
		tracker.settleBook("a", "success");
		tracker.settleBook("a", "success");
		tracker.settleBook("b", "failed");
		tracker.settleBook("c", "held");
		expect(tracker.state.counts).toEqual({
			total: 3,
			completed: 1,
			failed: 1,
			held: 1,
		});
		expect(tracker.state.currentBook).toBeNull();
		tracker.startPhase("save", 1);
		expect(tracker.state.counts).toEqual({
			total: 1,
			completed: 0,
			failed: 0,
			held: 0,
		});
	});
	it("keeps partial completion and zero-book results without a stale book title", () => {
		const tracker = new SyncProgressTracker(false);
		tracker.startPhase("save", 0);
		tracker.finish("completed", {
			total: 0,
			completed: 0,
			failed: 0,
			held: 0,
		});
		expect(tracker.state.status).toBe("completed");
		tracker.startPhase("save", 2);
		tracker.startBook("Last book");
		tracker.finish("partial", {
			total: 3,
			completed: 1,
			failed: 1,
			held: 1,
		});
		expect(tracker.state.currentBook).toBeNull();
		expect(tracker.state.counts.completed).toBe(1);
	});
});
describe("safe diagnostic causes", () => {
	it("retains recognized causes and filesystem codes, never arbitrary response or cookie text", () => {
		expect(
			safeErrorMessage(Error("Multiple notes have the same ASIN")),
		).toBe("Multiple notes have the same ASIN");
		expect(
			safeErrorMessage(
				Object.assign(Error("cookie=secret"), { code: "ENOSPC" }),
			),
		).toBe("Filesystem error: ENOSPC");
		expect(
			safeErrorMessage(
				Error(
					"<html>secret</html> Cookie: session=secret https://amazon.com/?token=secret",
				),
			),
		).not.toContain("secret");
	});
	it("accepts old settings without a record and rejects malformed records", () => {
		expect(readErrorRecord(undefined)).toBeUndefined();
		expect(
			readErrorRecord({ operation: "sync", issues: "bad" }),
		).toBeUndefined();
	});
});


afterEach(() => vi.useRealTimers());
describe("sync activity history", () => {
	it("records phase-specific outcomes and timing without counting a fetched book as saved", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1000);
		const tracker = new SyncProgressTracker(true);
		expect(tracker.state.startedAt).toBe(1000);
		expect(tracker.state.endedAt).toBeNull();
		tracker.startPhase("fetch", 1);
		tracker.startBook("A");
		vi.setSystemTime(1250);
		tracker.settleBook("a", "success");
		tracker.settleBook("a", "success");
		tracker.startPhase("save", 1);
		expect(tracker.state.counts.completed).toBe(0);
		tracker.startBook("A");
		vi.setSystemTime(2000);
		tracker.settleBook("a", "unchanged");
		tracker.finish("completed");
		const endings = tracker.state.activityLog.filter(e => e.kind === "book-end");
		expect(endings).toMatchObject([
			{ phase: "fetch", bookTitle: "A", outcome: "success", at: 1250, deltaMs: 250 },
			{ phase: "save", bookTitle: "A", outcome: "unchanged", at: 2000, deltaMs: 750 },
		]);
		expect(tracker.state.endedAt).toBe(2000);
		expect(tracker.state.activityLog[tracker.state.activityLog.length - 1]).toMatchObject({ kind: "result", status: "completed" });
	});
	it("retains the latest 250 entries including safe errors and terminal outcomes", () => {
		const tracker = new SyncProgressTracker(false);
		tracker.startPhase("save", 300);
		for (let i = 0; i < 300; i++) {
			tracker.startBook(`Book ${i}`);
			tracker.settleBook(String(i), i === 298 ? "held" : "success");
		}
		tracker.addIssue({ phase: "save", message: "cookie=secret <html>secret</html>" });
		tracker.addIssue({ phase: "save", message: "cookie=secret <html>secret</html>" });
		tracker.finish("partial");
		expect(tracker.state.activityLog).toHaveLength(250);
		expect(tracker.state.activityLog[0].id).toBeGreaterThan(1);
		expect(tracker.state.activityLog.filter(e => e.kind === "issue")).toHaveLength(1);
		expect(JSON.stringify(tracker.state.activityLog)).not.toContain("secret");
		expect(tracker.state.activityLog).toEqual(expect.arrayContaining([
			expect.objectContaining({ kind: "book-end", bookTitle: "Book 298", outcome: "held" }),
			expect.objectContaining({ kind: "result", status: "partial" }),
		]));
		expect(tracker.state.issues).toHaveLength(1);
	});
	it("logs names for failures settled without a start notification", () => {
		const tracker = new SyncProgressTracker(false);
		tracker.startPhase("save", 1);
		tracker.settleBook("a", "failed", "Unreadable book");
		expect(tracker.state.activityLog[tracker.state.activityLog.length - 1]).toMatchObject({
			kind: "book-end", phase: "save", bookTitle: "Unreadable book", outcome: "failed"
		});
		expect(tracker.state.counts.completed).toBe(0);
	});
});
