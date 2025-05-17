// settings.ts
import { App, Notice, PluginSettingTab, Setting } from "obsidian"; // Modal を削除
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
		const templateSettingContainer = containerEl.createDiv({
			cls: "kindle-template-setting-container",
		});
		templateSettingContainer.createEl("h3", { text: "Note Template" });
		templateSettingContainer.createEl("p", {
			text: "Edit your template below (uses Nunjucks syntax). See Nunjucks documentation for details. Click on a variable to insert it into the template.",
			cls: "setting-item-description",
		});

		const templateEditorLayout = templateSettingContainer.createDiv({
			cls: "kindle-template-editor-layout",
		});

		const editorColumn = templateEditorLayout.createDiv({
			cls: "kindle-template-editor-column",
		});

		const templateTextarea = editorColumn.createEl("textarea", {
			cls: "kindle-template-editor-textarea",
		});
		templateTextarea.value = this.plugin.settings.templateContent;
		templateTextarea.addEventListener("input", async (e) => {
			this.plugin.settings.templateContent = (
				e.target as HTMLTextAreaElement
			).value;
			await this.plugin.saveSettings();
		});

		const resetButton = editorColumn.createEl("button", {
			text: "Reset to Default",
			cls: "kindle-template-editor-button",
		});
		resetButton.addEventListener("click", async () => {
			templateTextarea.value = DEFAULT_SETTINGS.templateContent;
			this.plugin.settings.templateContent =
				DEFAULT_SETTINGS.templateContent;
			await this.plugin.saveSettings();
		});

		const variablesColumn = templateEditorLayout.createDiv({
			cls: "kindle-template-variables-column",
		});
		variablesColumn.createEl("h4", { text: "Available Variables" });

		const variablesTable = variablesColumn.createEl("table", {
			cls: "kindle-variables-table",
		});
		const tableHead = variablesTable.createEl("thead");
		const headerRow = tableHead.createEl("tr");
		headerRow.createEl("th", { text: "Variable" });
		headerRow.createEl("th", { text: "Description" });

		const tableBody = variablesTable.createEl("tbody");

		const templateVariables = [
			{ name: "title", description: "Book title" },
			{ name: "author", description: "Book author" },
			{
				name: "authorUrl",
				description: "URL to author's page (if available)",
			},
			{ name: "imageUrl", description: "URL to book cover image" },
			{
				name: "highlightsCount",
				description: "Number of highlights in the book",
			},
			{
				name: "lastAnnotatedDate",
				description: "Date of last highlight",
			},
			{ name: "publicationDate", description: "Book publication date" },
			{ name: "publisher", description: "Book publisher" },
			{ name: "url", description: "URL to book on Amazon" },
			{ name: "appLink", description: "Kindle app deep link" },
			{
				name: "asin",
				description: "Amazon Standard Identification Number",
			},
			{
				name: "highlights",
				description: "Pre-rendered list of highlights",
			},
		];

		templateVariables.forEach((variable) => {
			const row = tableBody.createEl("tr");
			const nameCell = row.createEl("td");
			const nameLink = nameCell.createEl("a", {
				text: `{{ ${variable.name} }}`,
				href: "#",
				cls: "kindle-variable-insert-link",
			});
			nameLink.addEventListener("click", (e) => {
				e.preventDefault();
				const varToInsert = `{{ ${variable.name} }}`;
				const cursorPos = templateTextarea.selectionStart;
				const currentValue = templateTextarea.value;
				templateTextarea.value =
					currentValue.substring(0, cursorPos) +
					varToInsert +
					currentValue.substring(templateTextarea.selectionEnd);
				templateTextarea.selectionStart =
					templateTextarea.selectionEnd =
						cursorPos + varToInsert.length;
				templateTextarea.focus();
				templateTextarea.dispatchEvent(new Event("input"));
			});
			row.createEl("td", { text: variable.description });
		});

		variablesColumn.createEl("h4", { text: "Nunjucks Syntax Examples" });
		const examplesContainer = variablesColumn.createDiv({
			cls: "kindle-syntax-examples",
		});
		this.addCodeExampleHelper(
			examplesContainer,
			"Conditional",
			`{% if author %}
- Author: {{ author }}
{% endif %}`
		);
		this.addCodeExampleHelper(
			examplesContainer,
			"Fallback Values",
			`{{ title or 'Untitled Book' }}
{{ author or 'Unknown Author' }}`
		);

		const styleEl = document.createElement("style");
		styleEl.textContent = `
			.kindle-template-setting-container {
				margin-top: 20px;
				border-top: 1px solid var(--background-modifier-border);
				padding-top: 20px;
			}
			.kindle-template-editor-layout {
				margin-top: 10px;
			}
			.kindle-template-editor-column {
				display: flex;
				flex-direction: column;
				margin-bottom: 25px; 
			}
			.kindle-template-variables-column {
				max-height: 450px; 
				overflow-y: auto;
				overflow-x: auto; 
				border-top: 1px solid var(--background-modifier-border); 
				padding-top: 15px; 
				padding-right: 10px; /* Added right padding */
				margin-top: 20px; 
			}
			.kindle-template-editor-textarea {
				width: 100%;
				height: 300px; 
				font-family: monospace;
				line-height: 1.5;
				padding: 10px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				background-color: var(--background-primary);
				color: var(--text-normal);
				resize: vertical;
				margin-bottom: 10px;
			}
			.kindle-template-editor-button {
				padding: 8px 15px;
				border-radius: 4px;
				background-color: var(--background-secondary);
				border: 1px solid var(--background-modifier-border);
				color: var(--text-normal);
				cursor: pointer;
				align-self: flex-start; 
			}
			.kindle-template-editor-button:hover {
				background-color: var(--background-secondary-alt);
			}
			.kindle-variables-table {
				width: 100%;
				border-collapse: collapse;
				margin-bottom: 15px;
				font-size: 0.9em;
				table-layout: fixed; 
			}
			.kindle-variables-table th, .kindle-variables-table td {
				border: 1px solid var(--background-modifier-border);
				padding: 6px;
				text-align: left;
				word-break: break-word; 
			}
			.kindle-variables-table th {
				background-color: var(--background-secondary);
			}
			.kindle-variables-table th:nth-child(1),
			.kindle-variables-table td:nth-child(1) {
    			width: 35%; 
			}
			.kindle-variables-table th:nth-child(2),
			.kindle-variables-table td:nth-child(2) {
    			width: 65%; 
			}
			.kindle-variable-insert-link {
				text-decoration: none;
				color: var(--text-accent);
			}
			.kindle-variable-insert-link:hover {
				text-decoration: underline;
			}
			.kindle-syntax-examples h4 {
				margin-top: 10px;
				margin-bottom: 5px;
			}
			.kindle-syntax-examples pre {
				background-color: var(--background-secondary);
				padding: 8px;
				border-radius: 4px;
				overflow-x: auto;
				font-size: 0.85em;
			}
		`;
		document.head.appendChild(styleEl);

		new Setting(containerEl)
			.setName("Amazon Region")
			.setDesc("Select your Amazon Kindle region")
			.addDropdown((dropdown) => {
				for (const key in AMAZON_REGIONS) {
					dropdown.addOption(key, AMAZON_REGIONS[key]);
				}
				dropdown
					.setValue(this.plugin.settings.amazonRegion)
					.onChange(async (value) => {
						if (AMAZON_REGIONS[value]) {
							this.plugin.settings.amazonRegion = value;
							await this.plugin.saveSettings();
						} else {
							new Notice(
								`Invalid Amazon region selected: ${value}. Reverting to default.`
							);
							this.plugin.settings.amazonRegion =
								DEFAULT_SETTINGS.amazonRegion;
							await this.plugin.saveSettings();
							this.display();
						}
					});
			});

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

	private addCodeExampleHelper(
		container: HTMLElement,
		title: string,
		code: string
	): void {
		const exampleDiv = container.createEl("div");
		exampleDiv.createEl("h4", { text: title });
		const pre = exampleDiv.createEl("pre");
		pre.createEl("code", { text: code });
	}
}
