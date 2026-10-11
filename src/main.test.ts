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
import { fetchBookMetadata } from "./services/metadata-service";
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
	p.saveData = vi.fn(async () => {});
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
	expect(p.syncProgress?.state.status).toBe("partial");
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

describe("persistent diagnostics and whole-sync counts", () => {
	it("keeps excluded rows separate from fetched and saved failures in the new UI", async () => {
		const p = plugin();
		const book = { id: "OK", asin: "OK", title: "Book" };
		const excludedRows = [
			{ row: 2, asin: "NO_TITLE", reason: "missing-title" as const },
			{ row: 3, asin: "OK", reason: "duplicate-asin" as const },
		];
		p.kindleApiService.lastFetchDiagnostics = { excludedRows, library: { status: "complete", snapshots: [] } } as any;
		vi.mocked(p.kindleApiService.fetchHighlights).mockImplementationOnce(async (_region, emitter) => {
			emitter.emit("fetch:booklist:end", { totalBooks: 2, excludedRows });
			return { books: [book], highlights: [], failedBooks: 1 };
		});
		vi.mocked(saveBookNotes).mockImplementationOnce(async (_io, _settings, _books, _highlights, _onBook, onSettled) => {
			onSettled?.(book, 0, { status: "unchanged", issues: [] });
			return { created: 0, updated: 1, added: 0, held: 0, failed: 0, errors: [], outcomes: [{ asin: "OK", status: "updated" }] };
		});
		await p.syncHighlights();
		expect(p.syncProgress?.state).toMatchObject({ status: "partial", counts: { total: 3, completed: 1, failed: 2, held: 0 } });
		expect(p.lastSyncResult?.failed).toBe(2);
		expect(p.lastSyncDiagnostics?.noteSave?.failed).toBe(0);
		expect(p.settings.lastErrorRecord?.issues).toContainEqual({ phase: "fetch", message: "Notebook library row excluded" });
	});
	it("retains excluded-row counts when metadata fails before note saving", async () => {
		const p = plugin();
		p.settings.downloadMetadata = true;
		const excludedRows = [{ row: 2, asin: "NO_TITLE", reason: "missing-title" as const }];
		p.kindleApiService.lastFetchDiagnostics = { excludedRows, library: { status: "complete", snapshots: [] } } as any;
		vi.mocked(p.kindleApiService.fetchHighlights).mockImplementationOnce(async (_region, emitter) => {
			emitter.emit("fetch:booklist:end", { totalBooks: 1, excludedRows });
			return { books: [{ id: "OK", asin: "OK", title: "Book" }], highlights: [], failedBooks: 0 };
		});
		vi.mocked(fetchBookMetadata).mockRejectedValueOnce(Error("Notebook navigation failed"));
		await p.syncHighlights();
		expect(saveBookNotes).not.toHaveBeenCalled();
		expect(p.syncProgress?.state).toMatchObject({ status: "failed", counts: { total: 2, completed: 0, failed: 2, held: 0 } });
		expect(p.lastSyncDiagnostics?.noteSave).toBeUndefined();
		expect(p.settings.lastErrorRecord?.issues).toContainEqual({ phase: "fetch", message: "Notebook library row excluded" });
	});
	it("saves safe failures and retains them through a successful sync and reload", async () => {
		const p = plugin();
		vi.mocked(p.kindleApiService.fetchHighlights).mockRejectedValueOnce(
			Error("Notebook navigation timed out"),
		);
		await p.syncHighlights();
		expect(p.settings.lastErrorRecord?.issues).toEqual([
			{ phase: "fetch", message: "Notebook navigation timed out" },
		]);
		const saved = JSON.parse(JSON.stringify(p.settings));
		await p.syncHighlights();
		expect(p.settings.lastErrorRecord).toEqual(saved.lastErrorRecord);
		const reloaded = plugin();
		reloaded.loadData = async () => saved;
		await reloaded.loadSettings();
		expect(reloaded.settings.lastErrorRecord).toEqual(
			saved.lastErrorRecord,
		);
		await reloaded.clearErrorRecord();
		expect(reloaded.settings.lastErrorRecord).toBeUndefined();
	});
	it("includes fetched failures in final counts and counts unchanged books as complete", async () => {
		const p = plugin();
		const b = { id: "B", asin: "B", title: "Successful book" };
		vi.mocked(p.kindleApiService.fetchHighlights).mockImplementationOnce(
			async (_region, emitter) => {
				emitter.emit("fetch:booklist:end", { totalBooks: 2 });
				emitter.emit("fetch:book:settled", {
					bookId: "0",
					bookTitle: "Failed book",
					status: "failed",
					error: "Notebook navigation failed",
				});
				emitter.emit("fetch:book:settled", {
					bookId: "1",
					bookTitle: b.title,
					status: "success",
				});
				return { books: [b], highlights: [], failedBooks: 1 };
			},
		);
		vi.mocked(saveBookNotes).mockImplementationOnce(
			async (_io, _settings, books, _highlights, onBook, onSettled) => {
				onBook?.(books[0], 0);
				onSettled?.(books[0], 0, { status: "unchanged", issues: [] });
				return {
					created: 0,
					updated: 0,
					added: 0,
					held: 0,
					failed: 0,
					errors: [],
				};
			},
		);
		await p.syncHighlights();
		expect(p.syncProgress?.state).toMatchObject({
			status: "partial",
			currentBook: null,
			counts: { total: 2, completed: 1, failed: 1, held: 0 },
		});
		expect(p.settings.lastErrorRecord?.issues).toHaveLength(1);
		expect(p.settings.lastErrorRecord?.issues[0].bookTitle).toBe(
			"Failed book",
		);
	});
	it("records login and logout failures without storing raw exceptions", async () => {
		const p = plugin();
		vi.mocked(p.kindleApiService.login).mockRejectedValueOnce(
			Error("Amazon login timed out"),
		);
		await p.loginAmazon();
		expect(p.settings.lastErrorRecord).toMatchObject({
			operation: "login",
			issues: [{ phase: "auth", message: "Amazon login timed out" }],
		});
		vi.mocked(p.kindleApiService.logout).mockRejectedValueOnce(
			Error("Cookie: private-secret"),
		);
		await expect(p.logoutAmazon("co.jp")).rejects.toThrow();
		expect(p.settings.lastErrorRecord?.operation).toBe("logout");
		expect(JSON.stringify(p.settings.lastErrorRecord)).not.toContain(
			"private-secret",
		);
	});
	it("keeps an in-memory error if saving diagnostics fails", async () => {
		const p = plugin();
		p.saveData = vi.fn(async () => {
			throw Error("disk unavailable");
		});
		vi.mocked(p.kindleApiService.login).mockResolvedValueOnce(false);
		await p.syncHighlights();
		expect(p.settings.lastErrorRecord?.operation).toBe("sync");
		expect(p.syncProgress?.state.status).toBe("failed");
	});
});

it("does not report fetched or metadata-prepared books as fully synced after a fatal error", async () => {
	const p = plugin();
	p.settings.downloadMetadata = true;
	const books = [
		{ id: "A", asin: "A", title: "A" },
		{ id: "B", asin: "B", title: "B" },
	];
	vi.mocked(p.kindleApiService.fetchHighlights).mockResolvedValueOnce({
		books,
		highlights: [],
		failedBooks: 0,
	});
	vi.mocked(fetchBookMetadata)
		.mockResolvedValueOnce({})
		.mockRejectedValueOnce(Error("Notebook navigation failed"));
	await p.syncHighlights();
	expect(p.syncProgress?.state.counts.completed).toBe(0);
	expect(p.syncProgress?.state.counts.total).toBe(2);
	expect(p.settings.lastErrorRecord?.issues[0].bookTitle).toBe("B");
});

it("keeps a newer diagnostic when an older clear fails", async () => {
	const p = plugin();
	const oldRecord = {
		at: "2026-10-10T12:00:00Z",
		operation: "sync" as const,
		region: "co.jp",
		status: "failed" as const,
		issues: [
			{
				phase: "fetch" as const,
				message: "Notebook navigation timed out",
			},
		],
	};
	const newRecord = {
		...oldRecord,
		at: "2026-10-10T12:01:00Z",
		operation: "login" as const,
		issues: [{ phase: "auth" as const, message: "Amazon login timed out" }],
	};
	p.settings.lastErrorRecord = oldRecord;
	let rejectClear!: (error: Error) => void;
	let first = true;
	p.saveData = async () => {
		if (first) {
			first = false;
			await new Promise<void>((_resolve, reject) => {
				rejectClear = reject;
			});
		}
	};
	const clearing = p.clearErrorRecord();
	await Promise.resolve();
	await Promise.resolve();
	const recording = p.recordError(newRecord);
	rejectClear(Error("disk unavailable"));
	await Promise.all([clearing, recording]);
	expect(p.settings.lastErrorRecord).toEqual(newRecord);
});

it("persists overlapping settings changes in order", async () => {
	const p = plugin();
	let release!: () => void;
	let first = true;
	let saved: any;
	p.saveData = async (data) => {
		if (first) {
			first = false;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		}
		saved = JSON.parse(JSON.stringify(data));
	};
	p.settings.lastErrorRecord = {
		at: "2026-10-10T12:00:00Z",
		operation: "sync",
		region: "co.jp",
		status: "failed",
		issues: [{ phase: "fetch", message: "Notebook navigation timed out" }],
	};
	const clearing = p.clearErrorRecord();
	await Promise.resolve();
	await Promise.resolve();
	const record = {
		at: "2026-10-10T12:01:00Z",
		operation: "login" as const,
		region: "co.jp",
		status: "failed" as const,
		issues: [{ phase: "auth" as const, message: "Amazon login timed out" }],
	};
	const recording = p.recordError(record);
	release();
	await Promise.all([clearing, recording]);
	expect(saved.lastErrorRecord).toEqual(record);
});
