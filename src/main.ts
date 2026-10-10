import { EventEmitter } from "events";
import { Modal, Notice, Plugin } from "obsidian";
import { loadTranslations, t } from "./i18n";
import { AmazonLogoutModal } from "./modals/AmazonLogoutModal";
import { PropertyMigrationModal } from "./modals/PropertyMigrationModal";
import { SyncProgressModal } from "./modals/SyncProgressModal";
import { KindleApiService } from "./services/kindle-api";
import { fetchBookMetadata } from "./services/metadata-service";
import {
	DEFAULT_PROPERTY_NAMES,
	PropertyNames,
	validatePropertyNames,
} from "./services/note-properties";
import {
	normalizeOutputDirectory,
	saveBookNotes,
} from "./services/note-writer";
import {
	MigrationPreview,
	previewMigration,
	runMigration,
} from "./services/property-migration";
import { createVaultIO } from "./services/vault-io";
import {
	DEFAULT_SETTINGS,
	KindleHighlightsSettings,
	KindleHighlightsSettingTab,
} from "./settings";

export default class KindleHighlightsPlugin extends Plugin {
	settings: KindleHighlightsSettings;
	kindleApiService: KindleApiService;
	private busy = false;
	private disposed = false;
	private previews = new WeakMap<MigrationPreview, string>();
	lastSyncResult: Awaited<ReturnType<typeof saveBookNotes>> | undefined;
	private propertyConfig() {
		return JSON.stringify([
			this.settings.outputDirectory,
			this.settings.propertyNames,
			this.settings.propertyNameHistory,
		]);
	}
	async onload() {
		await loadTranslations();
		await this.loadSettings();
		this.kindleApiService = new KindleApiService(
			this.app,
			this.settings.amazonSessionSecrets,
			() => this.saveSettings(),
		);
		this.addCommand({
			id: "sync-kindle-highlights",
			name: t("commands.syncKindleHighlights.name"),
			callback: () => this.syncHighlights(),
		});
		this.addCommand({
			id: "logout-kindle",
			name: t("commands.logoutKindle.name"),
			callback: () => {
				if (this.busy) {
					new Notice(t("sync.busy"));
					return;
				}
				new AmazonLogoutModal(this.app, () =>
					this.logoutAmazon(this.settings.amazonRegion),
				).open();
			},
		});
		this.addCommand({
			id: "migrate-kindle-properties",
			name: t("migration.title"),
			callback: () => this.showPropertyMigration(),
		});
		this.addRibbonIcon(
			"download",
			t("ribbon.syncKindleHighlights.tooltip"),
			() => this.syncHighlights(),
		);
		this.addSettingTab(new KindleHighlightsSettingTab(this.app, this));
	}
	onunload() {
		this.disposed = true;
		this.kindleApiService?.dispose();
	}
	async loadSettings() {
		const saved = (await this.loadData()) ?? {};
		this.settings = {
			...DEFAULT_SETTINGS,
			...saved,
			propertyNames: {
				...DEFAULT_PROPERTY_NAMES,
				...saved.propertyNames,
			},
			propertyNameHistory: Array.isArray(saved.propertyNameHistory)
				? saved.propertyNameHistory
				: [],
			amazonSessionSecrets: { ...saved.amazonSessionSecrets },
		};
		validatePropertyNames(this.settings.propertyNames);
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
	async changePropertyNames(next: PropertyNames) {
		validatePropertyNames(next);
		if (this.busy) throw new Error(t("sync.busy"));
		const old = { ...this.settings.propertyNames };
		if (JSON.stringify(old) === JSON.stringify(next)) return;
		// A previous key cannot become a different field: that would corrupt old notes.
		for (const field of Object.keys(next) as (keyof PropertyNames)[])
			for (const previous of [
				...this.settings.propertyNameHistory,
				old,
			]) {
				if (
					Object.keys(previous).some(
						(other) =>
							other !== field &&
							previous[other as keyof PropertyNames] ===
								next[field],
					)
				)
					throw new Error(t("migration.invalidNames"));
			}
		const history = [old, ...this.settings.propertyNameHistory].filter(
			(m, i, a) =>
				a.findIndex((n) => JSON.stringify(n) === JSON.stringify(m)) ===
				i,
		);
		this.settings.propertyNames = { ...next };
		this.settings.propertyNameHistory = history;
		await this.saveSettings();
	}
	async logoutAmazon(region: string) {
		if (this.busy) throw new Error(t("sync.busy"));
		this.busy = true;
		try {
			await this.kindleApiService.logout(region);
		} finally {
			this.busy = false;
		}
	}
	async loginAmazon() {
		if (this.busy) {
			new Notice(t("sync.busy"));
			return;
		}
		this.busy = true;
		try {
			new Notice(
				(await this.kindleApiService.login(this.settings.amazonRegion))
					? t("modals.amazonLogin.success")
					: t("sync.loginCancelledOrFailed"),
			);
		} catch {
			new Notice(t("auth.failed"));
		} finally {
			this.busy = false;
		}
	}
	async previewProperties(): Promise<MigrationPreview> {
		if (this.busy) throw new Error(t("sync.busy"));
		this.busy = true;
		try {
			const io = createVaultIO(this.app),
				dir = normalizeOutputDirectory(this.settings.outputDirectory);
			const paths = io
				.list()
				.filter((p) =>
					dir ? p.startsWith(dir + "/") : !p.includes("/"),
				);
			const preview = await previewMigration(
				paths,
				io,
				this.settings.propertyNames,
				this.settings.propertyNameHistory,
			);
			this.previews.set(preview, this.propertyConfig());
			return preview;
		} finally {
			this.busy = false;
		}
	}
	async applyProperties(preview: MigrationPreview) {
		if (this.busy) throw new Error(t("sync.busy"));
		if (this.previews.get(preview) !== this.propertyConfig())
			throw new Error("Unrecognized migration preview");
		this.previews.delete(preview);
		this.busy = true;
		try {
			const directory = `${this.app.vault.configDir}/plugins/${this.manifest.id}/backups/${new Date().toISOString().replace(/[:.]/g, "-")}`;
			return await runMigration(
				preview,
				createVaultIO(this.app),
				directory,
			);
		} finally {
			this.busy = false;
		}
	}
	async showPropertyMigration() {
		try {
			const preview = await this.previewProperties();
			new PropertyMigrationModal(this.app, preview, (p) =>
				this.applyProperties(p),
			).open();
		} catch {
			new Notice(t("migration.failed"));
		}
	}
	async syncHighlights() {
		if (this.busy) {
			new Notice(t("sync.busy"));
			return;
		}
		this.busy = true;
		const settings: KindleHighlightsSettings = JSON.parse(
			JSON.stringify(this.settings),
		);
		const emitter = new EventEmitter();
		const modal = new SyncProgressModal(this.app, emitter);
		modal.open();
		const showError = (message: string) => {
			new Notice(message);
			if (emitter.listenerCount("error")) emitter.emit("error", message);
		};
		try {
			if (!(await this.kindleApiService.login(settings.amazonRegion))) {
				showError(t("sync.loginCancelledOrFailed"));
				return;
			}
			const { books, highlights, failedBooks } =
				await this.kindleApiService.fetchHighlights(
					settings.amazonRegion,
					emitter,
				);
			if (this.disposed) return;
			if (settings.downloadMetadata)
				for (const book of books) {
					book.metadata = await fetchBookMetadata(
						book,
						settings.amazonRegion,
						true,
					);
				}
			if (this.disposed) return;
			emitter.emit("start", { totalBookCount: books.length });
			const result = await saveBookNotes(
				createVaultIO(this.app, () => !this.disposed),
				settings,
				books,
				highlights,
				(book, index) => {
					emitter.emit("book:start", {
						bookTitle: book.title,
						booksProcessedCount: index,
						totalBookCount: books.length,
					});
				},
			);
			result.failed += failedBooks;
			this.lastSyncResult = result;
			await this.kindleApiService.persist(settings.amazonRegion);
			if (result.failed || result.held) {
				showError(
					t("sync.partial", {
						failed: result.failed,
						held: result.held,
					}),
				);
				const report = new Modal(this.app);
				report.titleEl.setText(
					t("sync.partial", {
						failed: result.failed,
						held: result.held,
					}),
				);
				for (const error of result.errors)
					report.contentEl.createEl("p", { text: error });
				report.open();
			} else {
				emitter.emit("end");
				new Notice(
					t("sync.summary", {
						created: result.created,
						updated: result.updated,
						added: result.added,
					}),
				);
			}
		} catch {
			showError(t("sync.safeFailure"));
		} finally {
			this.busy = false;
		}
	}
}
