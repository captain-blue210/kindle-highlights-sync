import { describe, it, expect } from "vitest";
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
