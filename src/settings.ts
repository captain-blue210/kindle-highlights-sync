// settings.ts
import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
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
	// Updated default template using Nunjucks syntax
	templateContent: `---
aliases:
tags: []
created:
updated:
---

{% if imageUrl %}![image]({{imageUrl}})
{% endif %}

## 書籍情報
{% if authorUrl %}
- 著者: [{{author}}]({{authorUrl}})
{% elif author %}
- 著者: [[{{author}}]]
{% endif %}
{% if highlightsCount %}
- ハイライト数: {{highlightsCount}}
{% endif %}
{% if lastAnnotatedDate %}
- 最後にハイライトした日: {{lastAnnotatedDate}}
{% endif %}
{% if publicationDate %}
- 発行日: {{publicationDate}}
{% endif %}
{% if publisher %}
- 出版社: {{publisher}}
{% endif %}
{% if url %}
- [Amazon link]({{url}})
{% endif %}
{% if appLink %}
- [Kindle link]({{appLink}})
{% endif %}

## ハイライト
{# This variable contains the pre-rendered list of highlights #}
{{ highlights }}
`,
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
		// 2. テンプレート設定
		const templateSetting = new Setting(containerEl)
			.setName("Note Template")
			.setDesc(
				"Template for generated notes (uses Nunjucks syntax). See Nunjucks documentation for details."
			)
			.addTextArea((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.templateContent)
					.setValue(this.plugin.settings.templateContent)
					.onChange(async (value) => {
						this.plugin.settings.templateContent = value;
						await this.plugin.saveSettings();
					});
				// Make the text area taller
				text.inputEl.setAttr("rows", 20);
				// Add monospace font for better template editing
				text.inputEl.addClass("kindle-highlights-template-editor");
			});

		// Add help button for template variables
		templateSetting.addButton((button) => {
			return button
				.setIcon("help-circle")
				.setTooltip("Show template variables")
				.onClick(() => {
					// Create and open modal with template variables help
					this.showTemplateVariablesModal();
				});
		});

		// Add CSS for template editor
		const styleEl = document.createElement("style");
		styleEl.textContent = `
			.kindle-highlights-template-editor {
				font-family: monospace;
				line-height: 1.5;
			}
		`;
		document.head.appendChild(styleEl);

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

	/**
	 * Shows a modal with template variables help
	 */
	showTemplateVariablesModal(): void {
		const modal = new TemplateVariablesModal(this.app);
		modal.open();
	}
}

/**
 * Modal for displaying template variables help
 */
class TemplateVariablesModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Template Variables" });

		// Add description
		contentEl.createEl("p", {
			text: "The following variables are available in your template. Use them with Nunjucks syntax, e.g., {{ title }} or {% if author %}Author: {{ author }}{% endif %}",
		});

		// Create table for variables
		const table = contentEl.createEl("table");
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: "Variable" });
		headerRow.createEl("th", { text: "Description" });
		headerRow.createEl("th", { text: "Example" });

		const tbody = table.createEl("tbody");

		// Book variables
		this.addVariableRow(tbody, "title", "Book title", "The Great Gatsby");
		this.addVariableRow(
			tbody,
			"author",
			"Book author",
			"F. Scott Fitzgerald"
		);
		this.addVariableRow(
			tbody,
			"authorUrl",
			"URL to author's page (if available)",
			"https://amazon.com/author/..."
		);
		this.addVariableRow(
			tbody,
			"imageUrl",
			"URL to book cover image",
			"https://images-na.ssl-images-amazon.com/..."
		);
		this.addVariableRow(
			tbody,
			"highlightsCount",
			"Number of highlights in the book",
			"42"
		);
		this.addVariableRow(
			tbody,
			"lastAnnotatedDate",
			"Date of last highlight",
			"2025-03-15"
		);
		this.addVariableRow(
			tbody,
			"publicationDate",
			"Book publication date",
			"2024-01-01"
		);
		this.addVariableRow(
			tbody,
			"publisher",
			"Book publisher",
			"Penguin Books"
		);
		this.addVariableRow(
			tbody,
			"url",
			"URL to book on Amazon",
			"https://amazon.com/dp/..."
		);
		this.addVariableRow(
			tbody,
			"appLink",
			"Kindle app deep link",
			"kindle://book?action=open&asin=..."
		);
		this.addVariableRow(
			tbody,
			"asin",
			"Amazon Standard Identification Number",
			"B01N0XQL9Z"
		);

		// Highlight variables
		this.addVariableRow(
			tbody,
			"highlights",
			"Pre-rendered list of highlights",
			"- Highlight 1\n- Highlight 2"
		);

		// Add section for Nunjucks syntax examples
		contentEl.createEl("h3", { text: "Nunjucks Syntax Examples" });

		const codeExamples = contentEl.createEl("div", {
			cls: "template-code-examples",
		});

		// Conditional example
		this.addCodeExample(
			codeExamples,
			"Conditional",
			`{% if author %}
- Author: {{ author }}
{% endif %}`
		);

		// Loop example
		this.addCodeExample(
			codeExamples,
			"Variables with fallbacks",
			`{{ title or 'Untitled Book' }}
{{ author or 'Unknown Author' }}`
		);

		// Add CSS for the modal
		const styleEl = document.createElement("style");
		styleEl.textContent = `
			.template-variables-modal table {
				border-collapse: collapse;
				width: 100%;
				margin-bottom: 20px;
			}
			.template-variables-modal th, .template-variables-modal td {
				border: 1px solid var(--background-modifier-border);
				padding: 8px;
			}
			.template-variables-modal th {
				background-color: var(--background-secondary);
				text-align: left;
			}
			.template-variables-modal tr:nth-child(even) {
				background-color: var(--background-secondary);
			}
			.template-code-examples {
				margin-top: 20px;
			}
			.template-code-example {
				margin-bottom: 15px;
			}
			.template-code-example h4 {
				margin-bottom: 5px;
			}
			.template-code-example pre {
				background-color: var(--background-secondary);
				padding: 10px;
				border-radius: 4px;
				overflow-x: auto;
			}
		`;
		document.head.appendChild(styleEl);

		// Add class to modal for styling
		const modalEl = document.querySelector(".modal") as HTMLElement;
		if (modalEl) {
			modalEl.classList.add("template-variables-modal");
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	/**
	 * Adds a variable row to the table
	 */
	addVariableRow(
		tbody: HTMLTableSectionElement,
		name: string,
		description: string,
		example: string
	): void {
		const row = tbody.createEl("tr");
		row.createEl("td", { text: name });
		row.createEl("td", { text: description });
		row.createEl("td", { text: example });
	}

	/**
	 * Adds a code example to the container
	 */
	addCodeExample(container: HTMLElement, title: string, code: string): void {
		const example = container.createEl("div", {
			cls: "template-code-example",
		});
		example.createEl("h4", { text: title });
		const pre = example.createEl("pre");
		pre.createEl("code", { text: code });
	}
}
