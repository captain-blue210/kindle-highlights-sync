// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({
	Modal: class {
		contentEl = document.createElement("div");
		titleEl = document.createElement("h2");
		constructor(_app: unknown) {}
		open() {
			(this as any).onOpen();
		}
		close() {
			(this as any).onClose();
		}
	},
	moment: { locale: () => "ja" },
}));
import { NoteDestinationModal } from "./NoteDestinationModal";
import { loadTranslations } from "../i18n";
beforeEach(async () => {
	Object.assign(HTMLElement.prototype, {
		empty() {
			this.replaceChildren();
		},
		setText(text: string) {
			this.textContent = text;
		},
		createEl(tag: string, options: any = {}) {
			const el = document.createElement(tag);
			if (options.text) el.textContent = options.text;
			if (options.cls) el.className = options.cls;
			for (const [k, v] of Object.entries(options.attr ?? {}))
				el.setAttribute(k, String(v));
			this.append(el);
			return el;
		},
		createDiv() {
			return this.createEl("div");
		},
	});
	await loadTranslations("ja");
});
const candidates = [
	{ path: "books/<chosen>.md", content: "a", ctime: 10 },
	{ path: "books/Other.md", content: "b", ctime: 20 },
];
it("shows every candidate path, requires a choice and saves only the explicit candidate", async () => {
	const save = vi.fn(async () => {}),
		modal = new NoteDestinationModal(
			{} as any,
			[{ asin: "ABC", candidates }],
			save,
		);
	modal.open();
	const select = modal.contentEl.querySelector("select")!;
	const button = modal.contentEl.querySelector("button")!;
	expect(modal.contentEl.textContent).toContain(candidates[0].path);
	expect(modal.contentEl.textContent).toContain(candidates[1].path);
	expect(modal.contentEl.querySelector("chosen")).toBeNull();
	expect(select.value).toBe("");
	expect(button.disabled).toBe(true);
	select.value = candidates[1].path;
	select.dispatchEvent(new Event("change"));
	expect(button.disabled).toBe(false);
	button.click();
	await vi.waitFor(() =>
		expect(save).toHaveBeenCalledWith("ABC", candidates[1]),
	);
	await vi.waitFor(() =>
		expect(modal.contentEl.textContent).toContain("再同期"),
	);
});
it("keeps a vanished selection visible and does not auto-select its remaining candidate", () => {
	const modal = new NoteDestinationModal(
		{} as any,
		[
			{
				asin: "ABC",
				candidates: [candidates[1]],
				selected: {
					path: candidates[0].path,
					ctime: 10,
					invalidated: "deleted",
				},
			},
		],
		async () => {},
	);
	modal.open();
	expect(modal.contentEl.textContent).toContain(candidates[0].path);
	expect(modal.contentEl.querySelector("select")?.value).toBe("");
	expect(modal.contentEl.querySelector("button")?.disabled).toBe(true);
});
it("lets users retry a failed save and does not display success", async () => {
	const modal = new NoteDestinationModal(
		{} as any,
		[{ asin: "ABC", candidates }],
		async () => {
			throw Error("private");
		},
	);
	modal.open();
	const select = modal.contentEl.querySelector("select")!,
		button = modal.contentEl.querySelector("button")!;
	select.value = candidates[0].path;
	select.dispatchEvent(new Event("change"));
	button.click();
	await vi.waitFor(() => expect(button.disabled).toBe(false));
	expect(modal.contentEl.textContent).toContain("失敗");
	expect(modal.contentEl.textContent).not.toContain("private");
});
