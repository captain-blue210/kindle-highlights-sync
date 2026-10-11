import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => ({
	Plugin: class {},
	Modal: class {},
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
	PropertyMigrationModal: class {},
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
import Plugin from "./main";
import { fetchBookMetadata } from "./services/metadata-service";
import { saveBookNotes } from "./services/note-writer";
import { DEFAULT_PROPERTY_NAMES } from "./services/note-properties";
function plugin() {
	const p = new Plugin({} as any, {} as any);
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
beforeEach(() => vi.clearAllMocks());
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

describe("persistent diagnostics and whole-sync counts", () => {
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
