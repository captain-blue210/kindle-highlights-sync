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

			// テンプレートに基づいてノート内容を生成
			const content = renderTemplate(this.settings.templateContent, {
				book,
				highlights: bookHighlights,
			});

			// ファイル名の作成（特殊文字を置換）
			const fileName = `${book.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
			const filePath = this.settings.outputDirectory
				? `${this.settings.outputDirectory}/${fileName}`
				: fileName;

			// ファイルの存在確認
			const fileExists = await this.app.vault.adapter.exists(filePath);

			if (fileExists) {
				// 既存ファイルの更新
				const file = this.app.vault.getAbstractFileByPath(
					filePath
				) as TFile;
				await this.app.vault.modify(file, content);
			} else {
				// 新規ファイルの作成
				await this.app.vault.create(filePath, content);
			}
		}
	}
}
