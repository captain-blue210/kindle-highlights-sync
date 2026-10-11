import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { summaryOpen } = vi.hoisted(() => ({ summaryOpen: vi.fn() }));
vi.mock("obsidian", () => ({
	Plugin: class {},
	Modal: class {
		titleEl = { setText: vi.fn() };
		contentEl = { createEl: vi.fn() };
		open = summaryOpen;
	},
	Notice: vi.fn(),
}));
vi.mock("./i18n", () => ({
	loadTranslations: async () => {},
	t: (key: string) => key,
}));
vi.mock("./settings", () => ({
	DEFAULT_SETTINGS: {},
	KindleHighlightsSettingTab: class {},
}));
vi.mock("./modals/AmazonLogoutModal", () => ({ AmazonLogoutModal: class {} }));
vi.mock("./modals/PropertyMigrationModal", () => ({
	PropertyMigrationModal: class {
		titleEl = { setText: vi.fn() };
		contentEl = { createEl: vi.fn() };
		open = summaryOpen;
	},
}));
vi.mock("./modals/SyncProgressModal", () => ({
	SyncProgressModal: class {
		open() {}
	},
}));
vi.mock("./services/metadata-service", () => ({ fetchBookMetadata: vi.fn() }));
vi.mock("./services/vault-io", () => ({ createVaultIO: vi.fn() }));
vi.mock("./services/note-writer", () => ({
	normalizeOutputDirectory: (p: string) => p,
	saveBookNotes: vi.fn(async () => ({
		created: 0,
		updated: 1,
		added: 0,
		held: 0,
		failed: 0,
		errors: [],
	})),
}));
import { Notice } from "obsidian";
import Plugin from "./main";
import { saveBookNotes } from "./services/note-writer";
import { DEFAULT_PROPERTY_NAMES } from "./services/note-properties";
function plugin() {
	const p = new Plugin({} as any, {} as any);
	const files = new Map<string, string>();
	(p as any).app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: async () => true,
				mkdir: async () => {},
				write: async (path: string, content: string) => {
					files.set(path, content);
				},
			},
		},
	};
	(p as any).manifest = { id: "kindle-highlights-sync" };
	(p as any).reportFiles = files;
	p.settings = {
		amazonRegion: "co.jp",
		downloadMetadata: false,
		outputDirectory: "books",
		templateContent: "",
		propertyNames: { ...DEFAULT_PROPERTY_NAMES },
		propertyNameHistory: [],
		amazonSessionSecrets: {},
	};
	p.kindleApiService = {
		login: vi.fn(async () => true),
		fetchHighlights: vi.fn(async () => ({
			books: [],
			highlights: [],
			failedBooks: 0,
		})),
		persist: vi.fn(async () => {}),
		logout: vi.fn(async () => {}),
		dispose: vi.fn(),
	} as any;
	return p;
}
let backgroundThrottling = true;
let destroyed = false;
beforeEach(() => {
	vi.clearAllMocks();
	backgroundThrottling = true;
	destroyed = false;
	const host = { webContents: {
		isDestroyed: () => destroyed,
		getBackgroundThrottling: () => backgroundThrottling,
		setBackgroundThrottling: (value: boolean) => { backgroundThrottling = value; },
	} };
	vi.stubGlobal("window", {
		require: () => ({ remote: { getCurrentWindow: () => host } }),
	});
});
afterEach(() => vi.unstubAllGlobals());

describe("background synchronization lifecycle", () => {
	it.each(["complete", "login-cancelled", "fetch-failed"])(
		"keeps host timers running during %s and restores the original setting",
		async (outcome) => {
			const p = plugin();
			const observed: boolean[] = [];
			vi.mocked(p.kindleApiService.login).mockImplementation(async () => {
				observed.push(backgroundThrottling);
				return outcome !== "login-cancelled";
			});
			vi.mocked(p.kindleApiService.fetchHighlights).mockImplementation(async () => {
				observed.push(backgroundThrottling);
				if (outcome === "fetch-failed") throw Error("network");
				return { books: [], highlights: [], failedBooks: 0 };
			});
			await p.syncHighlights();
			expect(observed).toEqual(outcome === "login-cancelled" ? [false] : [false, false]);
			expect(backgroundThrottling).toBe(true);
			expect(p.lastSyncDiagnostics?.status).toBe(
				outcome === "complete" ? "complete" : outcome === "login-cancelled" ? "login-cancelled" : "failed",
			);
		},
	);
	it("restores immediately on unload and does not overwrite a later setting", async () => {
		const p = plugin();
		let finish!: (result: any) => void;
		vi.mocked(p.kindleApiService.fetchHighlights).mockReturnValue(new Promise(r => { finish = r; }));
		const pending = p.syncHighlights();
		await vi.waitFor(() => expect(p.kindleApiService.fetchHighlights).toHaveBeenCalled());
		expect(backgroundThrottling).toBe(false);
		p.onunload();
		expect(backgroundThrottling).toBe(true);
		backgroundThrottling = false; // Another owner changes it after the lease was released.
		finish({ books: [], highlights: [], failedBooks: 0 });
		await pending;
		expect(backgroundThrottling).toBe(false);
		expect(saveBookNotes).not.toHaveBeenCalled();
	});
	it("preserves an originally unthrottled host", async () => {
		backgroundThrottling = false;
		const p = plugin();
		await p.syncHighlights();
		expect(backgroundThrottling).toBe(false);
	});
	it("restores even if session disposal throws on unload", async () => {
		const p = plugin();
		let finish!: (result: any) => void;
		vi.mocked(p.kindleApiService.fetchHighlights).mockReturnValue(new Promise(r => { finish = r; }));
		const pending = p.syncHighlights();
		await vi.waitFor(() => expect(p.kindleApiService.fetchHighlights).toHaveBeenCalled());
		vi.mocked(p.kindleApiService.dispose).mockImplementation(() => { throw Error("closed"); });
		expect(() => p.onunload()).toThrow("closed");
		expect(backgroundThrottling).toBe(true);
		finish({ books: [], highlights: [], failedBooks: 0 });
		await pending;
	});
	it("does not navigate or save when the desktop timer bridge is unavailable", async () => {
		vi.stubGlobal("window", { require: () => ({}) });
		const p = plugin();
		await p.syncHighlights();
		expect(p.kindleApiService.login).not.toHaveBeenCalled();
		expect(saveBookNotes).not.toHaveBeenCalled();
		expect(p.lastSyncDiagnostics?.status).toBe("failed");
	});
	it("does not re-enable throttling while a second sync shares the same host", async () => {
		const p = plugin(), q = plugin();
		let finish!: (result: any) => void;
		vi.mocked(p.kindleApiService.fetchHighlights).mockReturnValue(new Promise(r => { finish = r; }));
		const pending = p.syncHighlights();
		await vi.waitFor(() => expect(p.kindleApiService.fetchHighlights).toHaveBeenCalled());
		await q.syncHighlights();
		expect(backgroundThrottling).toBe(false);
		finish({ books: [], highlights: [], failedBooks: 0 });
		await pending;
		expect(backgroundThrottling).toBe(true);
	});
	it("does not call the native setter after the host is destroyed", async () => {
		const p = plugin();
		const host = (globalThis.window as any).require("electron").remote.getCurrentWindow();
		host.webContents.setBackgroundThrottling = (value: boolean) => {
			if (destroyed) throw Error("Native host destroyed");
			backgroundThrottling = value;
		};
		vi.mocked(p.kindleApiService.fetchHighlights).mockImplementation(async () => {
			destroyed = true;
			return { books: [], highlights: [], failedBooks: 0 };
		});
		await p.syncHighlights();
		expect(p.lastSyncDiagnostics?.status).toBe("complete");
		expect((p as any).busy).toBe(false);
	});
	it("restores distinct vault windows independently", async () => {
		const p = plugin(), q = plugin();
		let finish!: (result: any) => void;
		vi.mocked(p.kindleApiService.fetchHighlights).mockReturnValue(new Promise(r => { finish = r; }));
		const pending = p.syncHighlights();
		await vi.waitFor(() => expect(p.kindleApiService.fetchHighlights).toHaveBeenCalled());
		let secondThrottling = true;
		const secondHost = { webContents: {
			isDestroyed: () => false,
			getBackgroundThrottling: () => secondThrottling,
			setBackgroundThrottling: (value: boolean) => { secondThrottling = value; },
		} };
		vi.stubGlobal("window", { require: () => ({ remote: { getCurrentWindow: () => secondHost } }) });
		await q.syncHighlights();
		expect(secondThrottling).toBe(true);
		expect(backgroundThrottling).toBe(false);
		finish({ books: [], highlights: [], failedBooks: 0 });
		await pending;
		expect(backgroundThrottling).toBe(true);
	});
});
describe("plugin transaction boundaries", () => {
	it("never writes notes when login is cancelled", async () => {
		const p = plugin();
		vi.mocked(p.kindleApiService.login).mockResolvedValue(false);
		await p.syncHighlights();
		expect(saveBookNotes).not.toHaveBeenCalled();
		expect(p.kindleApiService.fetchHighlights).not.toHaveBeenCalled();
	});
	it("never writes notes when notebook fetching fails", async () => {
		const p = plugin();
		vi.mocked(p.kindleApiService.fetchHighlights).mockRejectedValue(
			Error("network"),
		);
		await p.syncHighlights();
		expect(saveBookNotes).not.toHaveBeenCalled();
		expect(p.kindleApiService.persist).not.toHaveBeenCalled();
	});
	it("retains the metadata-only update result and persists a verified session", async () => {
		const p = plugin();
		await p.syncHighlights();
		expect(p.lastSyncResult?.updated).toBe(1);
		expect(p.lastSyncResult?.added).toBe(0);
		expect(p.kindleApiService.persist).toHaveBeenCalledWith("co.jp");
	});
	it("refuses synchronization while logout is running", async () => {
		const p = plugin();
		let finish!: () => void;
		vi.mocked(p.kindleApiService.logout).mockReturnValue(
			new Promise<void>((r) => {
				finish = r;
			}),
		);
		const loggingOut = p.logoutAmazon("co.jp");
		await p.syncHighlights();
		expect(p.kindleApiService.login).not.toHaveBeenCalled();
		finish();
		await loggingOut;
	});
});

it("persists ASIN diagnostics with separate fetch and note-save failures", async () => {
	const p = plugin();
	const fetchDiagnostics = {
		region: "co.jp",
		startedAt: "2026-10-11T03:00:00Z",
		library: { status: "complete", snapshots: [] },
		notebookAsins: ["OK", "FETCH_FAILED"],
		parsedAsins: ["OK", "FETCH_FAILED"],
		excludedRows: [],
		fetchedAsins: ["OK"],
		failedAnnotations: [
			{ asin: "FETCH_FAILED", reason: "annotation-fetch-failed" },
		],
	};
	p.kindleApiService.lastFetchDiagnostics = fetchDiagnostics as any;
	vi.mocked(p.kindleApiService.fetchHighlights).mockResolvedValue({
		books: [],
		highlights: [],
		failedBooks: 1,
	});
	vi.mocked(saveBookNotes).mockResolvedValueOnce({
		created: 0,
		updated: 0,
		added: 0,
		held: 0,
		failed: 1,
		errors: [],
		outcomes: [
			{ asin: "OK", status: "failed", reason: "duplicate-note-asin" },
		],
	} as any);
	await p.syncHighlights();
	const files = (p as any).reportFiles as Map<string, string>;
	expect(files.size).toBe(1);
	expect([...files.keys()][0]).toMatch(
		/^\.obsidian\/plugins\/kindle-highlights-sync\/diagnostics\/.+\.json$/,
	);
	const report = JSON.parse([...files.values()][0]);
	expect(report.fetch.failedAnnotations).toEqual([
		{ asin: "FETCH_FAILED", reason: "annotation-fetch-failed" },
	]);
	expect(report.noteSave.failed).toBe(1);
	expect(report.noteSave.outcomes).toMatchObject([
		{ asin: "OK", status: "failed" },
	]);
	expect(report.status).toBe("partial");
	expect(p.lastSyncResult?.failed).toBe(2);
	expect(summaryOpen).toHaveBeenCalledOnce();
	expect(Notice).not.toHaveBeenCalledWith("sync.safeFailure");
});

it("preserves an incomplete-library report and never writes notes", async () => {
	const p = plugin();
	p.kindleApiService.lastFetchDiagnostics = {
		library: { status: "unconfirmed", snapshots: [] },
		notebookAsins: ["ABC"],
		parsedAsins: ["ABC"],
		excludedRows: [],
		fetchedAsins: [],
		failedAnnotations: [],
	} as any;
	vi.mocked(p.kindleApiService.fetchHighlights).mockRejectedValue(
		Error("incomplete"),
	);
	await p.syncHighlights();
	expect(saveBookNotes).not.toHaveBeenCalled();
	const report = JSON.parse([...(p as any).reportFiles.values()][0]);
	expect(report.fetch.library.status).toBe("unconfirmed");
	expect(report.noteSave).toBeUndefined();
	expect(report.status).toBe("failed");
});
