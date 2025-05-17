import { Notice, Plugin, TFile } from "obsidian"; // Ensure App is imported
import { AmazonLogoutModal } from "./modals/AmazonLogoutModal"; // Import Logout Modal
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

		// Add ribbon icon at the end
		this.addRibbonIcon("download", "Sync Kindle Highlights", () =>
			this.syncHighlights()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async syncHighlights() {
		try {
			// 同期開始通知
			new Notice("Starting Kindle highlights sync...");

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

			new Notice("Fetching highlights...");

			// --- Step 2: Fetch Highlights ---
			// Use the service method
			const { books, highlights } =
				await this.kindleApiService.fetchHighlights(
					this.settings.amazonRegion
				);
			new Notice(
				`Found ${books.length} books and ${highlights.length} highlights.`
			); // Add feedback

			// メタデータの取得（オプション）
			if (this.settings.downloadMetadata) {
				await this.enrichBooksWithMetadata(books);
			}

			// 出力ディレクトリの確認と作成
			await this.ensureOutputDirectory();

			// ハイライトをObsidianノートとして保存
			await this.saveHighlightsAsNotes(books, highlights);

			// 完了通知
			new Notice(
				`Kindle highlights sync completed. Imported ${books.length} books and ${highlights.length} highlights.`
			);
		} catch (error) {
			console.error("Error syncing Kindle highlights:", error);
			new Notice(`Error syncing Kindle highlights: ${error.message}`);
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
		highlights: Highlight[]
	): Promise<void> {
		for (const book of books) {
			// 書籍ごとのハイライトをフィルタリング
			const bookHighlights = highlights.filter(
				(h) => h.bookId === book.id
			);

			if (bookHighlights.length === 0) continue;

			// Format highlights into a Markdown list string
			const highlightsString = bookHighlights
				.map((h) => {
					// Construct the appLink based on asin and location
					let appLink = `kindle://book?action=open&asin=${book.asin}`;
					if (h.location) {
						appLink += `&location=${h.location}`;
					}

					// Use the appLink in the Markdown output
					let item = `> ${h.text}\n> 位置: [${h.location}](${appLink})`; // <-- Link inserted here
					if (h.note) {
						// Indent note under the highlight
						item += `\n  - Note: ${h.note}`;
					}
					return `${item}\n`;
				})
				.join("\n");

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
