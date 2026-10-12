// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({
	Modal: class {
		contentEl = document.createElement("div");
		titleEl = document.createElement("h2");
		modalEl = document.createElement("div");
		constructor(_app: unknown) {
			this.modalEl.append(this.titleEl, this.contentEl);
		}
		open() {
			document.body.append(this.modalEl);
			(this as any).onOpen();
		}
		close() {
			(this as any).onClose();
			this.modalEl.remove();
		}
	},
	setIcon: (el: HTMLElement, name: string) =>
		el.setAttribute("data-icon", name),
	moment: { locale: () => "ja" },
}));
import { loadTranslations } from "../i18n";
import { SyncProgressTracker } from "../services/sync-progress";
import { renderErrorRecord } from "../ui/sync-diagnostics";
import { SyncProgressModal } from "./SyncProgressModal";

beforeEach(async () => {
	document.body.innerHTML = "";
	Object.assign(HTMLElement.prototype, {
		empty() {
			this.replaceChildren();
		},
		setText(text: string) {
			this.textContent = text;
		},
		addClass(cls: string) {
			this.classList.add(cls);
		},
		removeClass(cls: string) {
			this.classList.remove(cls);
		},
		createEl(tag: string, options: any = {}) {
			const el = document.createElement(tag);
			if (options.cls) el.className = options.cls;
			if (options.text) el.textContent = options.text;
			for (const [name, value] of Object.entries(options.attr ?? {}))
				el.setAttribute(name, String(value));
			this.append(el);
			return el;
		},
		createDiv(options: any = {}) {
			return this.createEl("div", options);
		},
	});
	await loadTranslations("ja");
});
describe("sync progress UI", () => {
	it("renders an indeterminate total then switches the book title and completed counts", () => {
		const tracker = new SyncProgressTracker(true);
		const modal = new SyncProgressModal({} as any, tracker);
		modal.open();
		expect(
			modal.contentEl.querySelector("progress")?.hasAttribute("value"),
		).toBe(false);
		tracker.startPhase("fetch", 2);
		const title = "長い書籍名".repeat(30);
		tracker.startBook(title);
		expect(
			modal.contentEl.querySelector(".kindle-sync-current-book")
				?.textContent,
		).toContain(title);
		expect(
			modal.contentEl.querySelector('[data-count="completed"]')
				?.textContent,
		).toContain("0");
		tracker.settleBook("first", "success");
		expect(
			modal.contentEl.querySelector('[data-count="completed"]')
				?.textContent,
		).toContain("1");
		expect(modal.contentEl.querySelector("progress")?.value).toBe(50);
		tracker.startBook("次の書籍");
		expect(
			modal.contentEl.querySelector(".kindle-sync-current-book")
				?.textContent,
		).toContain("次の書籍");
		expect(
			modal.contentEl.querySelector(".kindle-sync-current-book")
				?.textContent,
		).not.toContain(title);
		tracker.addIssue({
			phase: "fetch",
			bookTitle: "次の書籍",
			message: "Notebook navigation timed out",
		});
		tracker.settleBook("second", "failed");
		tracker.finish("partial");
		expect(modal.contentEl.querySelector("progress")?.value).toBe(100);
		expect(modal.titleEl.textContent).toContain("一部失敗");
		expect(modal.contentEl.textContent).toContain(
			"Notebook navigation timed out",
		);
		expect(
			modal.contentEl.querySelector(".kindle-sync-current-book")
				?.textContent,
		).not.toContain("次の書籍");
		expect(document.body.contains(modal.modalEl)).toBe(true);
	});
	it("removes only its own listener and can reopen showing the final result", () => {
		const tracker = new SyncProgressTracker(false);
		let updates = 0;
		tracker.on("change", () => updates++);
		const modal = new SyncProgressModal({} as any, tracker);
		modal.open();
		modal.close();
		tracker.startPhase("save", 0);
		tracker.finish("completed");
		expect(updates).toBe(2);
		expect(tracker.listenerCount("change")).toBe(1);
		modal.open();
		expect(modal.titleEl.textContent).toContain("同期完了");
		expect(modal.contentEl.querySelector("progress")?.value).toBe(100);
		expect(modal.contentEl.textContent).toContain("0");
	});
});

it("shows a saved diagnostic record as text and clears it through the provided action", async () => {
	const container = document.createElement("div");
	let cleared = false;
	renderErrorRecord(
		container,
		{
			at: "2026-10-10T12:00:00Z",
			operation: "sync",
			region: "co.jp",
			status: "partial",
			counts: { total: 2, completed: 1, failed: 1, held: 0 },
			issues: [
				{
					phase: "save",
					bookTitle: "<img src=x onerror=alert(1)>",
					path: "books/B.md",
					message: "Multiple notes have the same ASIN",
				},
			],
		},
		async () => {
			cleared = true;
			renderErrorRecord(container, undefined, async () => { });
		},
	);
	expect(container.textContent).toContain("co.jp");
	expect(container.textContent).toContain("books/B.md");
	expect(container.textContent).toContain(
		"Multiple notes have the same ASIN",
	);
	expect(container.querySelector("img")).toBeNull();
	container.querySelector("button")!.click();
	await Promise.resolve();
	expect(cleared).toBe(true);
	expect(container.textContent).toContain("保存されたエラーはありません");
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
function openProgress() {
	const tracker = new SyncProgressTracker(false);
	const modal = new SyncProgressModal({} as any, tracker);
	modal.open();
	return { tracker, modal };
}
function clipboard(writeText: (text: string) => Promise<void>) {
	vi.stubGlobal("navigator", { clipboard: { writeText } });
}
it("shows compact successful counts beside a bar that also includes failures and holds", () => {
	const { tracker, modal } = openProgress();
	tracker.startPhase("save", 3);
	tracker.startBook("長い書名".repeat(40));
	tracker.settleBook("1", "success");
	tracker.settleBook("2", "failed");
	tracker.settleBook("3", "held");
	expect(
		modal.contentEl.querySelector(".kindle-sync-count-label")?.textContent,
	).toBe("完了 1／全体 3冊");
	expect(
		modal.contentEl.querySelector(".kindle-sync-secondary-counts")
			?.textContent,
	).toBe("失敗 1冊・確認待ち 1冊");
	expect(modal.contentEl.querySelector("progress")?.value).toBe(100);
	tracker.finish("partial");
	expect(
		modal.contentEl.querySelector(".kindle-sync-result-count")?.textContent,
	).toContain("1");
	expect(
		modal.contentEl
			.querySelector(".kindle-sync-state-icon")
			?.getAttribute("data-icon"),
	).toBe("circle-alert");
});
it("copies localized safe activity text and elapsed intervals including phase-specific results", async () => {
	vi.useFakeTimers(); vi.setSystemTime(1000);
	let copied = "";
	clipboard(async (text) => {
		copied = text;
	});
	const { tracker, modal } = openProgress();
	tracker.startPhase("fetch", 1);
	tracker.startBook("<img src=x onerror=alert(1)>");
	vi.setSystemTime(1500);
	tracker.settleBook("1", "success");
	tracker.startPhase("save", 1);
	tracker.startBook("A");
	vi.setSystemTime(3000);
	tracker.settleBook("1", "unchanged");
	tracker.finish("completed");
	modal.contentEl
		.querySelector<HTMLButtonElement>(".kindle-sync-copy-log")!
		.click();
	await Promise.resolve();
	await Promise.resolve();
	expect(copied).toContain("取得完了");
	expect(copied).toContain("変更不要");
	expect(copied).toContain("+500ms");
	expect(copied).toContain("+1.5s");
	expect(copied).toContain("<img src=x onerror=alert(1)>");
	expect(modal.contentEl.querySelector("img")).toBeNull();
	expect(
		modal.contentEl.querySelector(".kindle-sync-copy-status")?.textContent,
	).toContain("コピーしました");
	expect(
		modal.contentEl.querySelector(".kindle-sync-log-book")?.textContent,
	).toContain("<img");
});
it("shows clipboard failure and keeps the current progress usable", async () => {
	clipboard(async () => { throw Error("denied"); });
	const { tracker, modal } = openProgress();
	modal.contentEl
		.querySelector<HTMLButtonElement>(".kindle-sync-copy-log")!
		.click();
	await Promise.resolve();
	await Promise.resolve();
	expect(
		modal.contentEl.querySelector(".kindle-sync-copy-status")?.textContent,
	).toContain("コピーできませんでした");
	expect(
		modal.contentEl.querySelector<HTMLButtonElement>(
			".kindle-sync-copy-log",
		)?.disabled,
	).toBe(false);
	tracker.startPhase("fetch", 2);
	expect(
		modal.contentEl.querySelector(".kindle-sync-count-label")?.textContent,
	).toContain("全体 2冊");
});
it("keeps a reader's scroll position and follows new entries only at the bottom", () => {
	const { tracker, modal } = openProgress();
	const body = modal.contentEl.querySelector<HTMLElement>(
		".kindle-sync-log-body",
	)!;
	expect(body).not.toBeNull();
	Object.defineProperties(body, {
		clientHeight: { get: () => 160, configurable: true },
		scrollHeight: {
			get: () => body.children.length * 40,
			configurable: true,
		},
	});
	for (let i = 0; i < 8; i++)tracker.startBook(`Book ${i}`);
	body.scrollTop = 40;
	tracker.startBook("Off-screen new book");
	expect(body.scrollTop).toBe(40);
	body.scrollTop = body.scrollHeight - body.clientHeight;
	tracker.startBook("Followed book");
	expect(body.scrollTop).toBe(body.scrollHeight - body.clientHeight);
});
it("restores activity accumulated after closing, without adding listener duplicates", () => {
	const { tracker, modal } = openProgress();
	modal.close();
	tracker.startPhase("save", 1); tracker.startBook("Background book");
	tracker.settleBook("1", "success"); tracker.finish("completed");
	modal.open();
	expect(
		modal.contentEl.querySelector(".kindle-sync-log-body")?.textContent,
	).toContain("Background book");
	expect(
		modal.contentEl.querySelector(".kindle-sync-log-body")?.textContent,
	).toContain("保存完了");
	expect(tracker.listenerCount("change")).toBe(1);
	expect(
		modal.contentEl.querySelector(".kindle-sync-current-book")?.textContent,
	).not.toContain("Background book");
});
it("renders the English result, logs and unknown-total message without translation keys", async () => {
	await loadTranslations("en");
	const { tracker, modal } = openProgress();
	expect(modal.contentEl.textContent).toContain("Determining total books");
	tracker.startPhase("save", 0); tracker.finish("completed");
	expect(modal.contentEl.textContent).toContain("Completed 0 of 0 books");
	expect(modal.contentEl.textContent).toContain("Sync complete");
	expect(modal.contentEl.textContent).not.toContain("progress.");
});

it("preserves fractional scroll offsets while repeatedly evicting capped log rows", () => {
	const { tracker, modal } = openProgress();
	for (let i = 0; i < 260; i++) tracker.startBook(`Book ${i}`);
	const body = modal.contentEl.querySelector<HTMLElement>(
		".kindle-sync-log-body",
	)!;
	Object.defineProperties(body, {
		clientHeight: { get: () => 160, configurable: true },
		scrollHeight: {
			get: () => body.children.length * 22.5,
			configurable: true,
		},
	});
	// DOM emulation has no layout; supply fractional geometry as measured in Obsidian.
	for (const row of Array.from(body.children)) {
		Object.defineProperty(row, "offsetHeight", {
			value: 22,
			configurable: true,
		});
		(row as HTMLElement).getBoundingClientRect = () =>
			({ height: 22.5 }) as DOMRect;
	}
	body.scrollTop = 500;
	for (let i = 0; i < 10; i++)tracker.startBook(`New book ${i}`);
	expect(body.children).toHaveLength(250);
	expect(body.scrollTop).toBe(275);
});

it("keeps fractional scroll remainders when the browser rounds applied offsets", () => {
	const { tracker, modal } = openProgress();
	for (let i = 0; i < 260; i++) tracker.startBook(`Book ${i}`);
	const body = modal.contentEl.querySelector<HTMLElement>(
		".kindle-sync-log-body",
	)!;
	let actualScroll = 0;
	Object.defineProperties(body, {
		clientHeight: { get: () => 160, configurable: true },
		scrollHeight: {
			get: () => body.children.length * 22.3,
			configurable: true,
		},
		scrollTop: {
			get: () => actualScroll,
			set: (value: number) => {
				actualScroll = Math.round(value * 2) / 2;
			},
			configurable: true,
		},
	});
	for (const row of Array.from(body.children)) {
		(row as HTMLElement).getBoundingClientRect = () =>
			({ height: 22.3 }) as DOMRect;
	}
	body.scrollTop = 500;
	for (let i = 0; i < 10; i++)tracker.startBook(`New book ${i}`);
	expect(body.scrollTop).toBe(277);
});

it("shows fetched and added highlights, standalone notes and attached memos separately", () => {
	const tracker = new SyncProgressTracker(false);
	const modal = new SyncProgressModal({} as any, tracker);
	modal.open();
	tracker.setAnnotationCounts("fetched", {
		highlights: 3,
		standaloneNotes: 2,
		attachedNotes: 1,
	});
	expect(
		modal.contentEl.querySelector(".kindle-sync-annotation-counts")
			?.textContent,
	).toContain("ハイライト 3");
	expect(
		modal.contentEl.querySelector(".kindle-sync-annotation-counts")
			?.textContent,
	).toContain("メモだけ 2");
	tracker.setAnnotationCounts("added", {
		highlights: 0,
		standaloneNotes: 1,
		attachedNotes: 1,
	});
	tracker.finish("completed");
	expect(
		modal.contentEl.querySelector(".kindle-sync-annotation-counts")
			?.textContent,
	).toContain("追加");
	expect(
		modal.contentEl.querySelector(".kindle-sync-annotation-counts")
			?.textContent,
	).toContain("添付メモ 1");
	modal.close();
});
