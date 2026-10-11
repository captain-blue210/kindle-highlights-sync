import { EventEmitter } from "events";
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadRemoteDom } from "./remote-loader";
import { libraryHtml, notebookWindow } from "../test-utils/notebook-window";
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

afterEach(() => vi.useRealTimers());

describe("Notebook library pagination readiness", () => {
	it("waits beyond five seconds for later ASINs and the actual terminal page", async () => {
		vi.useFakeTimers();
		const start = Date.now();
		const first = Array.from({ length: 148 }, (_, i) => `ASIN${i}`);
		const all = Array.from({ length: 256 }, (_, i) => `ASIN${i}`);
		const window = notebookWindow(() =>
			libraryHtml(
				Date.now() - start < 9000 ? first : all,
				Date.now() - start >= 9000,
			),
		);
		let resolved = false;
		const pending = loadRemoteDom(
			"https://read.amazon.co.jp/notebook",
			"agent",
			0,
			window as any,
			{ waitForLibrary: true },
		).then((result) => {
			resolved = true;
			return result;
		});
		await vi.advanceTimersByTimeAsync(5000);
		expect(resolved).toBe(false);
		await vi.advanceTimersByTimeAsync(4500);
		const result = await pending;
		expect(result.dom(".kp-notebook-library-each-book")).toHaveLength(256);
		expect(result.dom("#ASIN255")).toHaveLength(1);
		expect(result.library?.status).toBe("complete");
		expect(window.webContents.listenerCount("did-finish-load")).toBe(0);
	});
	it.each(["pending-token", "missing-token", "missing-spinner"])(
		"does not call a stable count complete: %s",
		async (kind) => {
			vi.useFakeTimers();
			let html = libraryHtml(["ABC"], true);
			if (kind === "pending-token")
				html = html.replace('value=""', 'value="pending"');
			if (kind === "missing-token")
				html = html.replace(/<input[^>]*>/g, "");
			if (kind === "missing-spinner")
				html = html.replace(
					/<div id="kp-notebook-library-spinner"[^>]*><\/div>/,
					"",
				);
			const pending = loadRemoteDom(
				"https://read.amazon.co.jp/notebook",
				"agent",
				0,
				notebookWindow(() => html) as any,
				{ waitForLibrary: true },
			);
			await vi.advanceTimersByTimeAsync(60000);
			const result = await pending;
			expect(result.library?.status).toBe("unconfirmed");
			expect(result.dom("#ABC")).toHaveLength(1);
		},
	);
	it("returns a load failure separately from an unconfirmed end", async () => {
		const html = libraryHtml(["ABC"], false).replace(
			'class="aok-hidden"',
			'class=""',
		);
		const result = await loadRemoteDom(
			"https://read.amazon.co.jp/notebook",
			"agent",
			0,
			notebookWindow(() => html) as any,
			{ waitForLibrary: true },
		);
		expect(result.library?.status).toBe("load-failed");
	});
});

it.each(["closed", "read-failed"])(
	"retains partial ASINs and observations after %s",
	async (kind) => {
		vi.useFakeTimers();
		const window = notebookWindow(() => libraryHtml(["ABC"], false));
		const pending = loadRemoteDom(
			"https://read.amazon.co.jp/notebook",
			"agent",
			0,
			window as any,
			{ waitForLibrary: true },
		).catch((error) => error);
		await vi.advanceTimersByTimeAsync(0);
		if (kind === "closed") {
			window.webContents.getURL = () => {
				throw Error("destroyed");
			};
			window.emit("closed");
		} else {
			window.webContents.executeJavaScript = async () => {
				throw Error("SECRET_COOKIE");
			};
			await vi.advanceTimersByTimeAsync(250);
		}
		const result = await pending;
		expect(result.library).toMatchObject({
			status: "load-failed",
			snapshots: [{ rows: 1 }],
		});
		expect(result.dom("#ABC")).toHaveLength(1);
		expect(window.webContents.listenerCount("did-finish-load")).toBe(0);
		expect(window.listenerCount("closed")).toBe(0);
		expect(JSON.stringify(result.library)).not.toContain("SECRET_COOKIE");
	},
);
