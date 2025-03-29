// settings.ts
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import KindleHighlightsPlugin from "./main";

// Define supported Amazon regions
const AMAZON_REGIONS: Record<string, string> = {
	com: "USA (.com)",
	"co.jp": "Japan (.co.jp)",
	"co.uk": "UK (.co.uk)",
	de: "Germany (.de)",
	fr: "France (.fr)",
	es: "Spain (.es)",
	it: "Italy (.it)",
	ca: "Canada (.ca)",
	"com.au": "Australia (.com.au)",
	"com.br": "Brazil (.com.br)",
	"com.mx": "Mexico (.com.mx)",
	in: "India (.in)",
};

export interface KindleHighlightsSettings {
	outputDirectory: string;
	templateContent: string;
	amazonRegion: string;
	downloadMetadata: boolean;
}

export const DEFAULT_SETTINGS: KindleHighlightsSettings = {
	outputDirectory: "Kindle Highlights",
	templateContent:
		"# {{title}}\n\n## Highlights\n\n{{#highlights}}\n> {{text}}\n\n{{/highlights}}",
	amazonRegion: "com",
	downloadMetadata: true,
};

export class KindleHighlightsSettingTab extends PluginSettingTab {
	plugin: KindleHighlightsPlugin;

	constructor(app: App, plugin: KindleHighlightsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// 1. ノート保存先ディレクトリ設定
		new Setting(containerEl)
			.setName("Output Directory")
			.setDesc("Directory where highlights will be saved")
			.addText((text) =>
				text
					.setPlaceholder("Kindle Highlights")
					.setValue(this.plugin.settings.outputDirectory)
					.onChange(async (value) => {
						this.plugin.settings.outputDirectory = value;
						await this.plugin.saveSettings();
					})
			);

		// 2. テンプレート設定
		new Setting(containerEl)
			.setName("Note Template")
			.setDesc("Template for generated notes")
			.addTextArea((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.templateContent)
					.setValue(this.plugin.settings.templateContent)
					.onChange(async (value) => {
						this.plugin.settings.templateContent = value;
						await this.plugin.saveSettings();
					})
			);

		// 3. Amazonリージョン設定 (Dropdown)
		new Setting(containerEl)
			.setName("Amazon Region")
			.setDesc("Select your Amazon Kindle region")
			.addDropdown((dropdown) => {
				// Add regions to dropdown
				for (const key in AMAZON_REGIONS) {
					dropdown.addOption(key, AMAZON_REGIONS[key]);
				}

				// Set current value and handle change
				dropdown
					.setValue(this.plugin.settings.amazonRegion)
					.onChange(async (value) => {
						if (AMAZON_REGIONS[value]) {
							this.plugin.settings.amazonRegion = value;
							await this.plugin.saveSettings();
						} else {
							// Handle potential invalid value if settings get corrupted
							new Notice(
								`Invalid Amazon region selected: ${value}. Reverting to default.`
							);
							this.plugin.settings.amazonRegion =
								DEFAULT_SETTINGS.amazonRegion;
							await this.plugin.saveSettings();
							// Refresh the settings display to show the reverted value
							this.display();
						}
					});
			});

		// 4. メタデータダウンロード設定
		new Setting(containerEl)
			.setName("Download Metadata")
			.setDesc("Download book metadata (cover, publication date, etc.)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.downloadMetadata)
					.onChange(async (value) => {
						this.plugin.settings.downloadMetadata = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
