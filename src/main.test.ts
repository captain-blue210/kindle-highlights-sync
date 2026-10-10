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
import { saveBookNotes } from "./services/note-writer";
import { DEFAULT_PROPERTY_NAMES } from "./services/note-properties";
function plugin() {
	const p = new Plugin({} as any, {} as any);
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
