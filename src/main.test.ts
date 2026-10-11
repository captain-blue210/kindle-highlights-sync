import { beforeEach, describe, expect, it, vi } from "vitest";
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
