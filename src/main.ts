import { Notice, Plugin, TFile } from "obsidian"; // Ensure App is imported
import { AmazonLoginModal, AmazonSession } from "./modals/AmazonLoginModal"; // Add this line
import { Book, Highlight } from "./models";
import { scrapeKindleHighlights } from "./services/kindle-api";
import { fetchBookMetadata } from "./services/metadata-service";
import { renderTemplate } from "./services/template-renderer";
import {
	DEFAULT_SETTINGS,
	KindleHighlightsSettings,
	KindleHighlightsSettingTab,
} from "./settings";

export default class KindleHighlightsPlugin extends Plugin {
	settings: KindleHighlightsSettings;

	async onload() {
		await this.loadSettings();

		// 5. コマンドから同期実行機能
		this.addCommand({
			id: "sync-kindle-highlights",
			name: "Sync Kindle Highlights",
			callback: () => this.syncHighlights(),
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

			// --- Step 1: Authentication ---
			// Use the new login modal, passing the region from settings
			const loginModal = new AmazonLoginModal(
				this.app,
				this.settings.amazonRegion
			);
			const session: AmazonSession | null = await loginModal.doLogin(); // Attempt login

			if (!session) {
				new Notice("Kindle login cancelled or failed.");
				return; // Stop sync if login doesn't succeed
			}
			new Notice("Login successful. Fetching highlights...");

			// --- Step 2: Scrape Highlights ---
			// Pass the authenticated session to the scraping function
			const { books, highlights } = await scrapeKindleHighlights(
				this.settings.amazonRegion,
				session // Pass session instead of credentials
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
				// Optionally update coverUrl if it was fetched
				if (metadata.coverUrl) {
					book.coverUrl = metadata.coverUrl;
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
