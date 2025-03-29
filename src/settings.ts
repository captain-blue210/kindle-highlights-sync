// settings.ts
import { App, PluginSettingTab, Setting } from "obsidian";
import KindleHighlightsPlugin from "./main";

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

		// 3. Amazonリージョン設定
		new Setting(containerEl)
			.setName("Amazon Region")
			.setDesc("Your Amazon region (com, co.jp, co.uk, etc.)")
			.addText((text) =>
				text
					.setPlaceholder("com")
					.setValue(this.plugin.settings.amazonRegion)
					.onChange(async (value) => {
						this.plugin.settings.amazonRegion = value;
						await this.plugin.saveSettings();
					})
			);

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
