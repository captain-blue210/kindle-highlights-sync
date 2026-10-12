import { NoteDestinationModal } from "./modals/NoteDestinationModal";
import {
	NoteDestination,
	groupNoteDestinations,
	invalidateNoteDestinations,
	noteAsin,
	readNoteDestinations,
} from "./services/note-destination";
import type { NoteSnapshot } from "./services/note-sync";
import {
	BookCounts,
	SyncErrorRecord,
	SyncPhase,
	SyncProgressTracker,
	readErrorRecord,
	safeErrorMessage,
} from "./services/sync-progress";
import { EventEmitter } from "events";
import { Notice, Plugin } from "obsidian";
import { loadTranslations, t } from "./i18n";
import { AmazonLogoutModal } from "./modals/AmazonLogoutModal";
import { PropertyMigrationModal } from "./modals/PropertyMigrationModal";
import { SyncProgressModal } from "./modals/SyncProgressModal";
import { FetchDiagnostics, KindleApiService } from "./services/kindle-api";
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
import { acquireBackgroundExecution } from "./utils/background-execution";
import {
	DEFAULT_SETTINGS,
	KindleHighlightsSettings,
	KindleHighlightsSettingTab,
} from "./settings";

export default class KindleHighlightsPlugin extends Plugin {
	settings: KindleHighlightsSettings;
	syncProgress?: SyncProgressTracker;
	readonly diagnostics = new EventEmitter();
	kindleApiService: KindleApiService;
	private busy = false;
	private disposed = false;
	private releaseBackgroundExecution: (() => void) | undefined;
	private settingsSave: Promise<void> = Promise.resolve();
	private pendingDestination?: { asin: string; selection: NoteDestination };
	private diagnosticRevision = 0;
	private previews = new WeakMap<MigrationPreview, string>();
	lastSyncResult: Awaited<ReturnType<typeof saveBookNotes>> | undefined;
	lastSyncDiagnostics:
		| {
				schemaVersion: 1;
				startedAt: string;
				finishedAt?: string;
				region: string;
				status: "complete" | "partial" | "failed" | "login-cancelled";
				fetch?: FetchDiagnostics;
				noteSave?: Awaited<ReturnType<typeof saveBookNotes>>;
		  }
		| undefined;
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
		this.registerEvent(
			this.app.vault.on("rename", (_file, oldPath) => {
				void this.invalidateDestinations(oldPath, "renamed");
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				void this.invalidateDestinations(file.path, "deleted");
			}),
		);
		this.addCommand({
			id: "choose-kindle-sync-destination",
			name: t("destinations.title"),
			callback: () => this.showNoteDestinations(),
		});
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
		try {
			this.kindleApiService?.dispose();
		} finally {
			try {
				this.releaseBackgroundExecution?.();
			} catch {
				console.error(
					"Kindle background timer setting could not be restored",
				);
			}
			this.releaseBackgroundExecution = undefined;
		}
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
			noteDestinations: readNoteDestinations(saved.noteDestinations),
			lastErrorRecord: readErrorRecord(saved.lastErrorRecord),
		};
		validatePropertyNames(this.settings.propertyNames);
	}
	async saveSettings(destination?: {
		asin: string;
		selection: NoteDestination;
	}) {
		const snapshot = JSON.parse(JSON.stringify(this.settings));
		const saving = this.settingsSave
			.catch(() => {})
			.then(async () => {
				// Destination changes commit only after persistence succeeds. A queued ordinary
				// settings snapshot must include the latest committed table, never a provisional one.
				snapshot.noteDestinations = JSON.parse(
					JSON.stringify(this.settings.noteDestinations),
				);
				if (destination)
					snapshot.noteDestinations[destination.asin] = {
						...destination.selection,
					};
				await this.saveData(snapshot);
				if (destination)
					this.settings.noteDestinations[destination.asin] =
						destination.selection;
			});
		this.settingsSave = saving;
		await saving;
	}
	async recordError(record: SyncErrorRecord) {
		this.diagnosticRevision++;
		this.settings.lastErrorRecord = readErrorRecord(record);
		this.diagnostics.emit("change");
		try {
			await this.saveSettings();
		} catch {
			new Notice(t("diagnostics.saveFailed"));
		}
	}
	async clearErrorRecord() {
		const previous = this.settings.lastErrorRecord;
		const revision = ++this.diagnosticRevision;
		delete this.settings.lastErrorRecord;
		try {
			await this.saveSettings();
		} catch {
			if (revision === this.diagnosticRevision)
				this.settings.lastErrorRecord = previous;
			new Notice(t("diagnostics.clearFailed"));
		}
		this.diagnostics.emit("change");
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
		} catch (error) {
			await this.recordError({
				at: new Date().toISOString(),
				operation: "logout",
				region,
				status: "failed",
				issues: [
					{ phase: "session", message: safeErrorMessage(error) },
				],
			});
			throw new Error(safeErrorMessage(error));
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
		const region = this.settings.amazonRegion;
		try {
			if (await this.kindleApiService.login(region))
				new Notice(t("modals.amazonLogin.success"));
			else {
				await this.recordError({
					at: new Date().toISOString(),
					operation: "login",
					region,
					status: "failed",
					issues: [
						{
							phase: "auth",
							message: "Login cancelled or not completed",
						},
					],
				});
				new Notice(t("sync.loginCancelledOrFailed"));
			}
		} catch (error) {
			await this.recordError({
				at: new Date().toISOString(),
				operation: "login",
				region,
				status: "failed",
				issues: [{ phase: "auth", message: safeErrorMessage(error) }],
			});
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

	async invalidateDestinations(path: string, reason: "renamed" | "deleted") {
		const changed = invalidateNoteDestinations(
			this.settings.noteDestinations,
			path,
			reason,
		);
		const pending = this.pendingDestination;
		const pendingChanged = pending
			? invalidateNoteDestinations(
					{ [pending.asin]: pending.selection },
					path,
					reason,
				)
			: false;
		if (!changed && !pendingChanged) return;
		try {
			await this.saveSettings();
		} catch {
			new Notice(t("destinations.failed"));
		}
	}
	async selectNoteDestination(asin: string, candidate: NoteSnapshot) {
		if (this.busy || this.disposed) throw new Error(t("sync.busy"));
		this.busy = true;
		try {
			const io = createVaultIO(this.app);
			const dir = normalizeOutputDirectory(this.settings.outputDirectory);
			const path = candidate.path;
			if (
				!path.endsWith(".md") ||
				!(dir ? path.startsWith(dir + "/") : !path.includes("/")) ||
				!io.list().includes(path)
			)
				throw new Error("Destination preview is stale");
			const ctime = io.identity?.(path);
			const fileId = io.fileIdentity?.(path);
			if (!fileId || fileId !== candidate.fileId)
				throw new Error(
					"Desktop vault filesystem identity unavailable",
				);
			if (
				!ctime ||
				!Number.isFinite(ctime) ||
				ctime < 0 ||
				ctime !== candidate.ctime
			)
				throw new Error("Destination preview is stale");
			const content = await io.read(path);
			if (
				this.disposed ||
				io.identity?.(path) !== ctime ||
				io.fileIdentity?.(path) !== fileId ||
				noteAsin(
					{ path, content },
					this.settings.propertyNames,
					this.settings.propertyNameHistory,
				) !== asin
			)
				throw new Error("Destination preview is stale");
			const selection: NoteDestination = { path, ctime, fileId };
			const pending = { asin, selection };
			this.pendingDestination = pending;
			await this.saveSettings(pending);
		} finally {
			this.pendingDestination = undefined;
			this.busy = false;
		}
	}
	async showNoteDestinations() {
		if (this.busy || this.disposed) {
			new Notice(t("sync.busy"));
			return;
		}
		this.busy = true;
		try {
			const io = createVaultIO(this.app);
			const dir = normalizeOutputDirectory(this.settings.outputDirectory);
			const notes: NoteSnapshot[] = [];
			for (const path of io
				.list()
				.filter(
					(p) =>
						p.endsWith(".md") &&
						(dir ? p.startsWith(dir + "/") : !p.includes("/")),
				)) {
				notes.push({
					path,
					ctime: io.identity?.(path),
					fileId: io.fileIdentity?.(path),
					content: await io.read(path),
				});
			}
			if (!this.disposed)
				new NoteDestinationModal(
					this.app,
					groupNoteDestinations(
						notes,
						this.settings.noteDestinations,
						this.settings.propertyNames,
						this.settings.propertyNameHistory,
					),
					async (asin, note) => {
						// The preview's IO retains the original TFile pin, including same-ctime replacements.
						if (
							io.identity?.(note.path) !== note.ctime ||
							io.fileIdentity?.(note.path) !== note.fileId
						)
							throw new Error("Destination preview is stale");
						await this.selectNoteDestination(asin, note);
					},
				).open();
		} catch {
			new Notice(t("destinations.failed"));
		} finally {
			this.busy = false;
		}
	}

	async syncHighlights() {
		if (this.disposed) return;
		if (this.busy) {
			new Notice(t("sync.busy"));
			return;
		}
		this.busy = true;
		this.lastSyncResult = undefined;
		const settings: KindleHighlightsSettings = JSON.parse(
			JSON.stringify(this.settings),
		);
        // Vault events can invalidate destinations while fetching or saving.
        settings.noteDestinations=this.settings.noteDestinations;
        const destinationsBeforeSave=JSON.stringify(settings.noteDestinations);
		const diagnostics: NonNullable<
			KindleHighlightsPlugin["lastSyncDiagnostics"]
		> = {
			schemaVersion: 1,
			startedAt: new Date().toISOString(),
			region: settings.amazonRegion,
			status: "failed",
		};
		this.lastSyncDiagnostics = diagnostics;
		let fetchStarted = false;
		let releaseBackgroundExecution: (() => void) | undefined;
		const tracker = (this.syncProgress = new SyncProgressTracker(
			settings.downloadMetadata,
		));
		const emitter = new EventEmitter();
		let totalBooks: number | null = null;
		let fetchFailed = 0;
		let excludedCount = 0;
		let exclusions: FetchDiagnostics["excludedRows"] = [];
		let phase: SyncPhase = "auth";
		let finalCounts: BookCounts | undefined;
		const trackExclusions = (rows: FetchDiagnostics["excludedRows"]) => {
			exclusions = rows.filter((row) => row.reason !== "duplicate-asin");
			excludedCount = exclusions.length;
			for (const _row of exclusions)
				tracker.addIssue({ phase: "fetch", message: "Notebook library row excluded" });
		};
		emitter.on(
			"fetch:booklist:end",
			({ totalBooks: total, excludedRows = [] }: { totalBooks: number; excludedRows?: FetchDiagnostics["excludedRows"] }) => {
				totalBooks = total;
				trackExclusions(excludedRows);
				tracker.startPhase("fetch", total);
			},
		);
		emitter.on(
			"fetch:highlights:start",
			({ bookTitle }: { bookTitle: string }) =>
				tracker.startBook(bookTitle),
		);
		emitter.on(
			"fetch:book:settled",
			(event: {
				bookId: string;
				bookTitle: string;
				status: "success" | "failed";
				error?: string;
			}) => {
				if (event.error)
					tracker.addIssue({
						phase: "fetch",
						bookTitle: event.bookTitle,
						message: event.error,
					});
				tracker.settleBook(event.bookId, event.status, event.bookTitle);
				fetchFailed = tracker.state.counts.failed;
			},
		);
		const overallCounts = (): BookCounts => {
			const saving = phase === "save" || phase === "session";
			return {
				total: totalBooks === null ? null : totalBooks + excludedCount,
				completed: saving ? tracker.state.counts.completed : 0,
				failed:
					excludedCount + fetchFailed +
					(saving
						? tracker.state.counts.failed
						: phase === "metadata" && tracker.state.currentBook
							? 1
							: 0),
				held: saving ? tracker.state.counts.held : 0,
			};
		};
		try {
			this.releaseBackgroundExecution = releaseBackgroundExecution = acquireBackgroundExecution();
			new SyncProgressModal(this.app, tracker).open();
			if (!(await this.kindleApiService.login(settings.amazonRegion))) {
				tracker.addIssue({
					phase: "auth",
					message: "Login cancelled or not completed",
				});
				diagnostics.status = "login-cancelled";
				tracker.finish("failed");
				new Notice(t("sync.loginCancelledOrFailed"));
				return;
			}
			if (this.disposed) return;
			fetchStarted = true;
			phase = "fetch";
			tracker.startPhase("fetch");
			const { books, highlights, failedBooks } =
				await this.kindleApiService.fetchHighlights(
					settings.amazonRegion,
					emitter,
				);
			fetchFailed = failedBooks;
			totalBooks ??= books.length + failedBooks;
			trackExclusions(this.kindleApiService.lastFetchDiagnostics?.excludedRows ?? exclusions);
			if (this.disposed) return;
			if (settings.downloadMetadata) {
				phase = "metadata";
				tracker.startPhase("metadata", books.length);
				for (const [index, book] of books.entries()) {
					tracker.startBook(book.title);
					book.metadata = await fetchBookMetadata(
						book,
						settings.amazonRegion,
						true,
					);
					tracker.settleBook(String(index), "success");
					if (this.disposed) return;
				}
			}
			phase = "save";
			tracker.startPhase("save", books.length);
			const result = await saveBookNotes(
				createVaultIO(this.app, () => !this.disposed),
				settings,
				books,
				highlights,
				(book) => tracker.startBook(book.title),
				(book, index, outcome) => {
					for (const issue of outcome.issues) tracker.addIssue(issue);
					tracker.settleBook(String(index), outcome.status, book.title);
				},
			);
			diagnostics.noteSave = JSON.parse(JSON.stringify(result));
			if (JSON.stringify(settings.noteDestinations) !== destinationsBeforeSave)
				await this.saveSettings();
			for (const row of exclusions) {
				result.errors.push(`Notebook row ${row.row}${row.asin ? ` (ASIN: ${row.asin})` : ""}: ${row.reason}`);
			}
			for (const issue of result.issues ?? []) tracker.addIssue(issue);
			finalCounts = overallCounts();
			result.failed += failedBooks + excludedCount;
			this.lastSyncResult = result;
			if (this.disposed) return;
			phase = "session";
			await this.kindleApiService.persist(settings.amazonRegion);
			const partial =
				result.failed > 0 ||
				result.held > 0 ||
				tracker.state.issues.length > 0;
			diagnostics.status = partial ? "partial" : "complete";
			tracker.finish(partial ? "partial" : "completed", finalCounts);
			new Notice(
				t(partial ? "sync.partial" : "sync.summary", {
					failed: result.failed,
					held: result.held,
					created: result.created,
					updated: result.updated,
					added: result.added,
				}),
			);
		} catch (error) {
			tracker.addIssue({
				phase,
				...(tracker.state.currentBook
					? { bookTitle: tracker.state.currentBook }
					: {}),
				message: safeErrorMessage(error),
			});
			tracker.finish(
				this.disposed
					? "interrupted"
					: phase === "session"
						? "partial"
						: "failed",
				finalCounts ?? overallCounts(),
			);
			const state = fetchStarted ? this.kindleApiService.lastFetchDiagnostics?.library.status : undefined;
			new Notice(t(state === "unconfirmed" ? "sync.libraryUnconfirmed" : state === "load-failed" ? "sync.libraryLoadFailed" : "sync.safeFailure"));
		} finally {
			try { releaseBackgroundExecution?.(); }
			catch {
				diagnostics.status = "failed";
				console.error("Kindle background timer setting could not be restored");
				tracker.addIssue({ phase: "session", message: "Desktop background timer setting could not be restored" });
				tracker.finish("failed", finalCounts ?? overallCounts());
				new Notice(t("sync.safeFailure"));
			}
			this.releaseBackgroundExecution = undefined;
			if (tracker.state.status === "running") {
				tracker.addIssue({ phase, message: "Plugin unloaded" });
				tracker.finish("interrupted", finalCounts ?? overallCounts());
			}
			if (diagnostics.status !== "login-cancelled")
				diagnostics.status = tracker.state.status === "completed" ? "complete" : tracker.state.status === "partial" ? "partial" : "failed";
			if (tracker.state.status !== "completed") {
				if (!tracker.state.issues.length)
					tracker.addIssue({ phase, message: "Unexpected error" });
				await this.recordError({
					at: new Date().toISOString(),
					operation: "sync",
					region: settings.amazonRegion,
					status: tracker.state.status as SyncErrorRecord["status"],
					counts: tracker.state.counts,
					issues: tracker.state.issues,
				});
			}
			if (fetchStarted)
				diagnostics.fetch = this.kindleApiService.lastFetchDiagnostics;
			diagnostics.finishedAt = new Date().toISOString();
			try {
				const directory = `${this.app.vault.configDir}/plugins/${this.manifest.id}/diagnostics`;
				const adapter = this.app.vault.adapter;
				if (!(await adapter.exists(directory)))
					await adapter.mkdir(directory);
				await adapter.write(
					`${directory}/${diagnostics.startedAt.replace(/[:.]/g, "-")}.json`,
					JSON.stringify(diagnostics, null, 2) + "\n",
				);
			} catch {
				console.error(
					"Kindle sync diagnostics could not be saved; retained in lastSyncDiagnostics",
				);
				new Notice(t("sync.diagnosticsWriteFailed"));
			}
			emitter.removeAllListeners();
			this.busy = false;
		}
	}
}
