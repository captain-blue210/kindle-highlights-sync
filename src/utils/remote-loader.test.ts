import { EventEmitter } from "events";
import { describe, it, expect, vi } from "vitest";
import { loadRemoteDom } from "./remote-loader";
function fakeWindow() {
	const wc = Object.assign(new EventEmitter(), {
		getURL: () => "",
		executeJavaScript: vi.fn(async () => "<div>ok</div>"),
		reload: vi.fn(),
	});
	const window = {
		webContents: wc,
		isDestroyed: () => false,
		loadURL: vi.fn(async () => {
			queueMicrotask(() => wc.emit("did-finish-load"));
		}),
	};
	return window;
}
describe("remote notebook lifecycle", () => {
	it("preserves listeners owned by the session controller", async () => {
		const window = fakeWindow(),
			other = vi.fn();
		window.webContents.on("did-finish-load", other);
		const result = await loadRemoteDom(
			"https://read.amazon.co.jp/notebook?token=SECRET",
			"agent",
			0,
			window as any,
		);
		expect(result.html).toContain("ok");
		expect(window.webContents.listeners("did-finish-load")).toEqual([
			other,
		]);
	});
	it("rejects cancelled navigation without leaking its URL", async () => {
		const window = fakeWindow();
		window.loadURL.mockImplementation(async () => {
			throw Error("https://amazon.co.jp/?token=SECRET");
		});
		await expect(
			loadRemoteDom(
				"https://read.amazon.co.jp/notebook?token=SECRET",
				"agent",
				0,
				window as any,
			),
		).rejects.toThrow("Notebook navigation failed");
	});
});
