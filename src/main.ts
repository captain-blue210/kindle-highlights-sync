import { EventEmitter } from "events"; // Import EventEmitter
import { Notice, Plugin, TFile } from "obsidian"; // Ensure App is imported
import { loadTranslations, t } from "./i18n"; // Import i18n functions
import { AmazonLogoutModal } from "./modals/AmazonLogoutModal"; // Import Logout Modal
import { SyncProgressModal } from "./modals/SyncProgressModal"; // Import Progress Modal
import { Book, Highlight } from "./models";
import { KindleApiService } from "./services/kindle-api"; // Import the service class
import { fetchBookMetadata } from "./services/metadata-service";
import { renderTemplate } from "./services/template-renderer";
import {
	DEFAULT_SETTINGS,
	KindleHighlightsSettings,
	KindleHighlightsSettingTab,
} from "./settings";

export default class KindleHighlightsPlugin extends Plugin {
	settings: KindleHighlightsSettings;
	kindleApiService: KindleApiService; // Add service instance member

	async onload() {
		await loadTranslations(); // Load translations
		await this.loadSettings();
		this.kindleApiService = new KindleApiService(this.app); // Instantiate the service

		this.addCommand({
			id: "sync-kindle-highlights",
			name: t("commands.syncKindleHighlights.name"),
			callback: () => this.syncHighlights(),
		});

		this.addCommand({
			id: "logout-kindle",
			name: t("commands.logoutKindle.name"),
			callback: () => {
				new AmazonLogoutModal(
					this.app,
					this.kindleApiService,
					this.settings.amazonRegion
				).open();
			},
		});

		this.addSettingTab(new KindleHighlightsSettingTab(this.app, this));
	}

	onunload() {
		// Plugin cleanup
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);

		this.addRibbonIcon(
			"download",
			t("ribbon.syncKindleHighlights.tooltip"),
			() => this.syncHighlights()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async syncHighlights() {
		const emitter = new EventEmitter();
		const progressModal = new SyncProgressModal(this.app, emitter);
		progressModal.open();

		try {
			// Progress modal handles initial messages

			// --- Step 1: Authentication (Check & Trigger) ---
			let isLoggedIn = this.kindleApiService.isLoggedIn();

			if (!isLoggedIn) {
				new Notice(t("sync.sessionNotFound")); // Still useful to notify before modal might show login
				const loginSuccess = await this.kindleApiService.login(
					this.settings.amazonRegion
				);
				if (!loginSuccess) {
					new Notice(t("sync.loginCancelledOrFailed"));
					emitter.emit("error", t("sync.loginCancelledOrFailed")); // Notify modal too
					return; // Stop sync if login doesn't succeed
				}
				isLoggedIn = this.kindleApiService.isLoggedIn();
			}

			if (!isLoggedIn) {
				new Notice(t("sync.loginRequired"));
				emitter.emit("error", t("sync.loginRequired"));
				return;
			}

			// Fetching highlights notice is handled by modal/emitter

			// --- Step 2: Fetch Highlights ---
			const { books, highlights } =
				await this.kindleApiService.fetchHighlights(
					this.settings.amazonRegion,
					emitter // Pass emitter
				);

			// Emit 'start' after fetching books to know the total count
			emitter.emit("start", books.length);

			// Found books and highlights notice is handled by modal/emitter

			if (this.settings.downloadMetadata) {
				await this.enrichBooksWithMetadata(books);
			}

			await this.ensureOutputDirectory();
			await this.saveHighlightsAsNotes(books, highlights, emitter);

			emitter.emit("end");
			// Completion notice is handled by modal
		} catch (error) {
			console.error("Error syncing Kindle highlights:", error);
			emitter.emit("error", error.message || t("sync.unknownError")); // Use translated unknownError
		}
	}

	private async enrichBooksWithMetadata(books: Book[]): Promise<void> {
		if (!this.settings.downloadMetadata) {
			console.log(
				"Skipping metadata enrichment as it's disabled in settings."
			);
			return;
		}

		console.log(`Enriching metadata for ${books.length} books...`);
		for (const book of books) {
			try {
				const metadata = await fetchBookMetadata(
					book,
					this.settings.amazonRegion,
					this.settings.downloadMetadata
				);
				book.metadata = metadata;
				if (metadata.imageUrl) {
					book.imageUrl = metadata.imageUrl;
				}
			} catch (error) {
				console.warn(
					`Failed to fetch metadata for book ${book.title}:`,
					error
				);
			}
		}
	}

	private async ensureOutputDirectory(): Promise<void> {
		const outputDir = this.settings.outputDirectory;
		if (!outputDir) return;

		const dirExists = await this.app.vault.adapter.exists(outputDir);
		if (!dirExists) {
			await this.app.vault.createFolder(outputDir);
		}
	}

	private async saveHighlightsAsNotes(
		books: Book[],
		highlights: Highlight[],
		emitter: EventEmitter
	): Promise<void> {
		for (const book of books) {
			const currentBookIndex = books.findIndex((b) => b.id === book.id);
			const booksProcessedCount = currentBookIndex;

			emitter.emit("book:start", {
				bookTitle: book.title,
				booksProcessedCount: booksProcessedCount,
				totalBookCount: books.length,
			});

			const bookHighlights = highlights.filter(
				(h) => h.bookId === book.id
			);

			if (bookHighlights.length === 0) {
				emitter.emit("book:end", {
					bookTitle: book.title,
					booksProcessedCount: booksProcessedCount + 1,
					totalBookCount: books.length,
				});
				continue;
			}

			const highlightItems: string[] = [];
			let highlightsProcessedCountForBook = 0;

			for (const highlight of bookHighlights) {
				highlightsProcessedCountForBook++;

				emitter.emit("progress", {
					bookTitle: book.title,
					booksProcessedCount: booksProcessedCount,
					totalBookCount: books.length,
					highlightsProcessedCountForBook:
						highlightsProcessedCountForBook,
					currentHighlightText: highlight.text,
				});

				let appLink = `kindle://book?action=open&asin=${book.asin}`;
				if (highlight.location) {
					appLink += `&location=${highlight.location}`;
				}

				let item = `> ${highlight.text}\n> ${t(
					"noteOutput.locationLabel"
				)}: [${highlight.location}](${appLink})`;
				if (highlight.note) {
					item += `\n  - ${t("noteOutput.noteLabel")}: ${
						highlight.note
					}`;
				}
				highlightItems.push(`${item}\n`);
			}

			const highlightsString = highlightItems.join("\n");

			emitter.emit("book:end", {
				bookTitle: book.title,
				booksProcessedCount: booksProcessedCount + 1,
				totalBookCount: books.length,
			});

			const formattedLastAnnotatedDate = book.lastAnnotatedDate
				? book.lastAnnotatedDate.toISOString().split("T")[0]
				: undefined;

			const context = {
				book: book,
				...book,
				highlights: highlightsString,
				highlightsCount: bookHighlights.length,
				lastAnnotatedDate: formattedLastAnnotatedDate,
				authorUrl: book.metadata?.authorUrl,
				publicationDate: book.metadata?.publicationDate,
				publisher: book.metadata?.publisher,
				appLink: book.metadata?.appLink,
			};

			let content: string;
			try {
				content = renderTemplate(
					this.settings.templateContent,
					context
				);
			} catch (error) {
				console.error(
					`Error rendering template for book "${book.title}":`,
					error
				);
				new Notice(
					t("sync.templateError", {
						bookTitle: book.title,
						errorMessage: error.message || t("sync.unknownError"),
					})
				);
				continue;
			}

			const fileName = `${book.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
			let normalizedDir = this.settings.outputDirectory;
			if (normalizedDir) {
				normalizedDir = normalizedDir.replace(/^\/+|\/+$/g, "");
			}
			const filePath = normalizedDir
				? `${normalizedDir}/${fileName}`
				: fileName;

			console.log(
				`[Kindle Sync] Preparing to save/update file. Calculated filePath: "${filePath}"`
			);

			const fileExists = await this.app.vault.adapter.exists(filePath);
			console.log(
				`[Kindle Sync] File exists check for "${filePath}": ${fileExists}`
			);

			if (fileExists) {
				const file = this.app.vault.getAbstractFileByPath(
					filePath
				) as TFile;
				if (!file) {
					console.error(
						`[Kindle Sync] Error: File object is null for path "${filePath}" despite exists check returning true. Skipping modification.`
					);
					new Notice(
						t("sync.fileProcessingError", { filePath: filePath })
					);
					continue;
				}
				await this.app.vault.modify(file, content);
				console.log(
					`[Kindle Sync] Successfully modified file: "${filePath}"`
				);
			} else {
				await this.app.vault.create(filePath, content);
				console.log(
					`[Kindle Sync] Successfully created file: "${filePath}"`
				);
			}
		}
	}
}
