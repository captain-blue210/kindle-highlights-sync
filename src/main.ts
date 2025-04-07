import { EventEmitter } from "events"; // Import EventEmitter
import { Notice, Plugin, TFile } from "obsidian"; // Ensure App is imported
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
		await this.loadSettings();
		this.kindleApiService = new KindleApiService(this.app); // Instantiate the service

		// 5. コマンドから同期実行機能
		this.addCommand({
			id: "sync-kindle-highlights",
			name: "Sync Kindle Highlights",
			callback: () => this.syncHighlights(),
		});

		// Add Logout command
		this.addCommand({
			id: "logout-kindle",
			name: "Logout from Kindle",
			callback: () => {
				// Show confirmation modal
				new AmazonLogoutModal(
					this.app,
					this.kindleApiService,
					this.settings.amazonRegion // Pass the current region
				).open();
			},
		});

		// 設定タブの追加
		this.addSettingTab(new KindleHighlightsSettingTab(this.app, this));
	}

	onunload() {
		// プラグインのクリーンアップ処理
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
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
			// 同期開始通知 (Modalが代わりになる)
			// new Notice("Starting Kindle highlights sync...");

			// --- Step 1: Authentication (Check & Trigger) ---
			let isLoggedIn = this.kindleApiService.isLoggedIn();

			if (!isLoggedIn) {
				new Notice("Amazon session not found. Please log in.");
				const loginSuccess = await this.kindleApiService.login(
					this.settings.amazonRegion
				);
				if (!loginSuccess) {
					new Notice("Kindle login cancelled or failed.");
					return; // Stop sync if login doesn't succeed
				}
				// Re-check status after successful login attempt
				isLoggedIn = this.kindleApiService.isLoggedIn();
			}

			if (!isLoggedIn) {
				// Should not happen if login succeeded, but as a safeguard
				new Notice("Login required to sync highlights.");
				return;
			}

			// new Notice("Fetching highlights..."); // Modalが代わりになる

			// --- Step 2: Fetch Highlights ---
			// Use the service method
			// --- Emit Start Event ---
			// We need the total book count *before* starting the detailed processing.
			// Let's assume fetchHighlights gives us this, or we modify it.
			// For now, let's fetch first, then emit start. This isn't ideal for the UI
			// but avoids modifying KindleApiService immediately.
			const { books, highlights } =
				await this.kindleApiService.fetchHighlights(
					this.settings.amazonRegion,
					emitter // ★ Pass emitter
				);

			// Emit 'start' after fetching books to know the total count
			emitter.emit("start", books.length);

			// new Notice(
			// 	`Found ${books.length} books and ${highlights.length} highlights.`
			// ); // Modal will show progress

			// メタデータの取得（オプション）
			if (this.settings.downloadMetadata) {
				await this.enrichBooksWithMetadata(books);
			}

			// 出力ディレクトリの確認と作成
			await this.ensureOutputDirectory();

			// ハイライトをObsidianノートとして保存
			// Pass emitter to saveHighlightsAsNotes
			await this.saveHighlightsAsNotes(books, highlights, emitter);

			// --- Emit End Event ---
			emitter.emit("end");

			// 完了通知 (Modalが代わりになる)
			// new Notice(
			// 	`Kindle highlights sync completed. Imported ${books.length} books and ${highlights.length} highlights.`
			// );
		} catch (error) {
			console.error("Error syncing Kindle highlights:", error);
			// --- Emit Error Event ---
			emitter.emit("error", error.message || "Unknown error occurred");
			// new Notice(`Error syncing Kindle highlights: ${error.message}`); // Modal handles error display
		} finally {
			// The modal should close itself based on 'end' or 'error' events.
			// Additional checks here might be redundant or cause issues if the modal
			// is already in the process of closing.
		}
	}

	private async enrichBooksWithMetadata(books: Book[]): Promise<void> {
		// Check if metadata download is enabled in settings
		if (!this.settings.downloadMetadata) {
			console.log(
				"Skipping metadata enrichment as it's disabled in settings."
			);
			return; // Exit if disabled
		}

		console.log(`Enriching metadata for ${books.length} books...`);
		for (const book of books) {
			try {
				// Pass the whole book object and the setting flag
				const metadata = await fetchBookMetadata(
					book, // Pass the book object
					this.settings.amazonRegion, // Pass region
					this.settings.downloadMetadata // Pass setting flag
				);
				// Assign the fetched/structured metadata back to the book object
				book.metadata = metadata;
				// Optionally update imageUrl if it was fetched
				if (metadata.imageUrl) {
					// Check for imageUrl
					book.imageUrl = metadata.imageUrl; // Assign to imageUrl
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

		// ディレクトリが存在するか確認
		const dirExists = await this.app.vault.adapter.exists(outputDir);

		// 存在しない場合は作成
		if (!dirExists) {
			await this.app.vault.createFolder(outputDir);
		}
	}

	private async saveHighlightsAsNotes(
		books: Book[],
		highlights: Highlight[],
		emitter: EventEmitter // Add emitter parameter
	): Promise<void> {
		for (const book of books) {
			// --- Emit book:start ---
			// We need the index or a counter for booksProcessedCount
			const currentBookIndex = books.findIndex((b) => b.id === book.id); // Find index for count
			const booksProcessedCount = currentBookIndex; // Index is 0-based, count should be too for 'start'

			emitter.emit("book:start", {
				bookTitle: book.title,
				booksProcessedCount: booksProcessedCount, // Count before this book starts
				totalBookCount: books.length,
			});

			// 書籍ごとのハイライトをフィルタリング
			const bookHighlights = highlights.filter(
				(h) => h.bookId === book.id
			);

			if (bookHighlights.length === 0) {
				// Emit book:end even if no highlights
				emitter.emit("book:end", {
					bookTitle: book.title,
					booksProcessedCount: booksProcessedCount + 1, // Increment count as this book is done
					totalBookCount: books.length,
				});
				continue; // Skip to next book
			}

			// --- Process Highlights and Emit progress ---
			const highlightItems: string[] = []; // Store formatted highlight strings
			let highlightsProcessedCountForBook = 0;

			for (const highlight of bookHighlights) {
				highlightsProcessedCountForBook++;

				// Emit progress for each highlight
				emitter.emit("progress", {
					bookTitle: book.title,
					booksProcessedCount: booksProcessedCount, // Count remains the same during this book's processing
					totalBookCount: books.length,
					highlightsProcessedCountForBook:
						highlightsProcessedCountForBook,
					currentHighlightText: highlight.text,
				});

				// Construct the appLink based on asin and location
				let appLink = `kindle://book?action=open&asin=${book.asin}`;
				if (highlight.location) {
					appLink += `&location=${highlight.location}`;
				}

				// Format individual highlight item
				let item = `> ${highlight.text}\n> 位置: [${highlight.location}](${appLink})`;
				if (highlight.note) {
					item += `\n  - Note: ${highlight.note}`;
				}
				highlightItems.push(`${item}\n`); // Add formatted item to array

				// Optional: Add a small delay to make progress visible if sync is too fast
				// await new Promise(resolve => setTimeout(resolve, 10));
			}

			// Join formatted highlights after the loop
			const highlightsString = highlightItems.join("\n");

			// --- Emit book:end ---
			emitter.emit("book:end", {
				bookTitle: book.title,
				booksProcessedCount: booksProcessedCount + 1, // Increment count as this book is done
				totalBookCount: books.length,
			});

			// Format lastAnnotatedDate (if available) to YYYY-MM-DD
			const formattedLastAnnotatedDate = book.lastAnnotatedDate
				? book.lastAnnotatedDate.toISOString().split("T")[0]
				: undefined;

			// Prepare context for Nunjucks, ensuring all expected keys are present
			const context = {
				// Include the book object itself, as required by TemplateContext
				book: book,
				// Spread book properties for direct access (title, author, url, imageUrl, etc.)
				...book,
				// Add derived/formatted values
				highlights: highlightsString,
				highlightsCount: bookHighlights.length,
				lastAnnotatedDate: formattedLastAnnotatedDate,
				// Ensure other potential template variables are at least undefined if not in book
				authorUrl: book.metadata?.authorUrl, // Example: assuming it might be in metadata
				publicationDate: book.metadata?.publicationDate,
				publisher: book.metadata?.publisher,
				appLink: book.metadata?.appLink,
			};

			let content: string;
			try {
				// テンプレートに基づいてノート内容を生成
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
					`Template Error for "${book.title}": ${
						error.message || "Unknown error"
					}. Skipping this book.`
				);
				continue; // Skip to the next book if template rendering fails
			}

			// ファイル名の作成（特殊文字を置換）
			const fileName = `${book.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;

			// Normalize output directory path (remove leading/trailing slashes)
			let normalizedDir = this.settings.outputDirectory;
			if (normalizedDir) {
				normalizedDir = normalizedDir.replace(/^\/+|\/+$/g, ""); // Remove leading/trailing slashes
			}

			// Construct the final path relative to the vault root
			const filePath = normalizedDir
				? `${normalizedDir}/${fileName}`
				: fileName;

			console.log(
				`[Kindle Sync] Preparing to save/update file. Calculated filePath: "${filePath}"`
			); // Log filePath

			// ファイルの存在確認
			const fileExists = await this.app.vault.adapter.exists(filePath);
			console.log(
				`[Kindle Sync] File exists check for "${filePath}": ${fileExists}`
			); // Log exists result

			if (fileExists) {
				// 既存ファイルの更新
				console.log(
					`[Kindle Sync] Attempting to get existing file object for: "${filePath}"`
				); // Log before get
				const file = this.app.vault.getAbstractFileByPath(
					filePath
				) as TFile;
				console.log(
					`[Kindle Sync] Result of getAbstractFileByPath for "${filePath}":`,
					file
				); // Log the file object (or null)

				if (!file) {
					// Add a check here!
					console.error(
						`[Kindle Sync] Error: File object is null for path "${filePath}" despite exists check returning true. Skipping modification.`
					);
					new Notice(
						`Error processing file: ${filePath}. File object not found.`
					);
					continue; // Skip this book to prevent the error
				}

				console.log(
					`[Kindle Sync] Attempting to modify file: "${filePath}"`
				); // Log before modify
				// console.log(`[Kindle Sync] Content for modify:`, content); // Optional: Log content if needed
				await this.app.vault.modify(file, content);
				console.log(
					`[Kindle Sync] Successfully modified file: "${filePath}"`
				); // Log after modify
			} else {
				// 新規ファイルの作成
				console.log(
					`[Kindle Sync] Attempting to create new file: "${filePath}"`
				); // Log before create
				// console.log(`[Kindle Sync] Content for create:`, content); // Optional: Log content if needed
				await this.app.vault.create(filePath, content);
				console.log(
					`[Kindle Sync] Successfully created file: "${filePath}"`
				); // Log after create
			}
		}
	}
}
