// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
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
		expect(modal.contentEl.textContent).not.toContain(title);
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
			renderErrorRecord(container, undefined, async () => {});
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
