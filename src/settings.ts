// settings.ts
import { App, Notice, PluginSettingTab, Setting } from "obsidian"; // Modal を削除
import { t } from "./i18n"; // Import t function
import KindleHighlightsPlugin from "./main";
import { renderTemplate } from "./services/template-renderer";

// Define supported Amazon regions (keys will be used for translation keys)
const AMAZON_REGION_KEYS: string[] = [
	"com",
	"co.jp",
	"co.uk",
	"de",
	"fr",
	"es",
	"it",
	"ca",
	"com.au",
	"com.br",
	"com.mx",
	"in",
];

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
			.setName(t("settings.outputDirectory.name"))
			.setDesc(t("settings.outputDirectory.description"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.outputDirectory.placeholder"))
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
		templateSettingContainer.createEl("h3", {
			text: t("settings.noteTemplate.title"),
		});
		templateSettingContainer.createEl("p", {
			text: t("settings.noteTemplate.description"),
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
		
		// Create preview column
		const previewColumn = templateEditorLayout.createDiv({
			cls: "kindle-template-preview-column",
		});
		previewColumn.createEl("h4", {
			text: t("settings.noteTemplate.preview.title"),
		});
		previewColumn.createEl("p", {
			text: t("settings.noteTemplate.preview.description"),
			cls: "setting-item-description",
		});

		const previewContainer = previewColumn.createDiv({
			cls: "kindle-template-preview-container",
		});

		// Function to update preview
		const updatePreview = () => {
			try {
				const sampleData = this.createSampleTemplateData();
				const rendered = renderTemplate(templateTextarea.value, sampleData);
				previewContainer.innerHTML = `<pre class="kindle-template-preview-content">${rendered}</pre>`;
			} catch (error) {
				previewContainer.innerHTML = `
					<div class="kindle-template-preview-error">
						<h5>${t("settings.noteTemplate.preview.errorTitle")}</h5>
						<p>${t("settings.noteTemplate.preview.errorDescription")}</p>
						<pre class="kindle-template-error-details">${error.message || error}</pre>
					</div>
				`;
			}
		};

		// Initial preview render
		updatePreview();

		templateTextarea.addEventListener("input", async (e) => {
			this.plugin.settings.templateContent = (
				e.target as HTMLTextAreaElement
			).value;
			await this.plugin.saveSettings();
			updatePreview(); // Update preview on change
		});

		const resetButton = editorColumn.createEl("button", {
			text: t("settings.noteTemplate.resetButton"),
			cls: "kindle-template-editor-button",
		});
		resetButton.addEventListener("click", async () => {
			templateTextarea.value = DEFAULT_SETTINGS.templateContent;
			this.plugin.settings.templateContent =
				DEFAULT_SETTINGS.templateContent;
			await this.plugin.saveSettings();
			updatePreview(); // Update preview after reset
		});

		const variablesColumn = templateEditorLayout.createDiv({
			cls: "kindle-template-variables-column",
		});
		variablesColumn.createEl("h4", {
			text: t("settings.noteTemplate.variables.title"),
		});

		const variablesTable = variablesColumn.createEl("table", {
			cls: "kindle-variables-table",
		});
		const tableHead = variablesTable.createEl("thead");
		const headerRow = tableHead.createEl("tr");
		headerRow.createEl("th", {
			text: t("settings.noteTemplate.variables.headerVariable"),
		});
		headerRow.createEl("th", {
			text: t("settings.noteTemplate.variables.headerDescription"),
		});

		const tableBody = variablesTable.createEl("tbody");

		const templateVariables = [
			{
				name: "title",
				descriptionKey: "settings.noteTemplate.variables.bookTitle",
			},
			{
				name: "author",
				descriptionKey: "settings.noteTemplate.variables.bookAuthor",
			},
			{
				name: "authorUrl",
				descriptionKey: "settings.noteTemplate.variables.authorUrl",
			},
			{
				name: "imageUrl",
				descriptionKey: "settings.noteTemplate.variables.imageUrl",
			},
			{
				name: "highlightsCount",
				descriptionKey:
					"settings.noteTemplate.variables.highlightsCount",
			},
			{
				name: "lastAnnotatedDate",
				descriptionKey:
					"settings.noteTemplate.variables.lastAnnotatedDate",
			},
			{
				name: "publicationDate",
				descriptionKey:
					"settings.noteTemplate.variables.publicationDate",
			},
			{
				name: "publisher",
				descriptionKey: "settings.noteTemplate.variables.publisher",
			},
			{
				name: "url",
				descriptionKey: "settings.noteTemplate.variables.amazonUrl",
			},
			{
				name: "appLink",
				descriptionKey: "settings.noteTemplate.variables.kindleAppLink",
			},
			{
				name: "asin",
				descriptionKey: "settings.noteTemplate.variables.asin",
			},
			{
				name: "highlights",
				descriptionKey:
					"settings.noteTemplate.variables.preRenderedHighlights",
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
				updatePreview(); // Update preview after variable insertion
			});
			row.createEl("td", { text: t(variable.descriptionKey) });
		});

		variablesColumn.createEl("h4", {
			text: t("settings.noteTemplate.syntaxExamples.title"),
		});
		const examplesContainer = variablesColumn.createDiv({
			cls: "kindle-syntax-examples",
		});
		this.addCodeExampleHelper(
			examplesContainer,
			t("settings.noteTemplate.syntaxExamples.conditional.title"),
			`{% if author %}
- Author: {{ author }}
{% endif %}`
		);
		this.addCodeExampleHelper(
			examplesContainer,
			t("settings.noteTemplate.syntaxExamples.fallback.title"),
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
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 20px;
			}
			.kindle-template-editor-column {
				display: flex;
				flex-direction: column;
				margin-bottom: 25px; 
			}
			.kindle-template-preview-column {
				display: flex;
				flex-direction: column;
				margin-bottom: 25px;
			}
			.kindle-template-preview-container {
				flex: 1;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				overflow: auto;
				max-height: 350px;
				background-color: var(--background-primary);
			}
			.kindle-template-preview-content {
				margin: 0;
				padding: 10px;
				white-space: pre-wrap;
				word-wrap: break-word;
				font-family: var(--font-text);
				font-size: 0.9em;
				line-height: 1.5;
				background: transparent;
			}
			.kindle-template-preview-error {
				padding: 15px;
				color: var(--text-error);
			}
			.kindle-template-preview-error h5 {
				margin: 0 0 8px 0;
				color: var(--text-error);
			}
			.kindle-template-preview-error p {
				margin: 0 0 10px 0;
				font-size: 0.9em;
			}
			.kindle-template-error-details {
				background-color: var(--background-secondary);
				padding: 8px;
				border-radius: 4px;
				font-size: 0.8em;
				margin: 0;
				overflow-x: auto;
			}
			.kindle-template-variables-column {
				max-height: 450px; 
				overflow-y: auto;
				overflow-x: auto; 
				border-top: 1px solid var(--background-modifier-border); 
				padding-top: 15px; 
				padding-right: 10px;
				margin-top: 20px;
				grid-column: 1 / -1;
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
			.setDesc(t("settings.amazonRegion.description"))
			.addDropdown((dropdown) => {
				for (const key of AMAZON_REGION_KEYS) {
					// Iterate over keys
					dropdown.addOption(
						key,
						t(`settings.amazonRegion.regions.${key}`)
					); // Use translated region name
				}
				dropdown
					.setValue(this.plugin.settings.amazonRegion)
					.onChange(async (value) => {
						if (AMAZON_REGION_KEYS.includes(value)) {
							// Check if the value is a valid key
							this.plugin.settings.amazonRegion = value;
							await this.plugin.saveSettings();
						} else {
							new Notice(
								t("settings.amazonRegion.invalidRegionError", {
									value: value,
								})
							);
							this.plugin.settings.amazonRegion =
								DEFAULT_SETTINGS.amazonRegion;
							await this.plugin.saveSettings();
							this.display(); // Refresh display to show reverted value
						}
					});
			});

		new Setting(containerEl)
			.setName(t("settings.downloadMetadata.name"))
			.setDesc(t("settings.downloadMetadata.description"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.downloadMetadata)
					.onChange(async (value) => {
						this.plugin.settings.downloadMetadata = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private createSampleTemplateData() {
		return {
			book: {
				id: "B001234567",
				title: "サンプル書籍タイトル",
				author: "サンプル著者",
				asin: "B001234567",
				url: "https://amazon.com/dp/B001234567",
				imageUrl: "https://m.media-amazon.com/images/I/sample.jpg",
				lastAnnotatedDate: new Date("2024-01-15"),
				metadata: {}
			},
			highlights: `### チャプター1: はじめに

> これは最初のハイライトです。重要なポイントを示しています。
**Location:** 123-125

**Note:** これは重要な概念です。

---

> 二番目のハイライトには、さらに詳細な説明が含まれています。
**Location:** 456-460

---

> 最後のハイライトは結論部分からのものです。
**Location:** 789-792

**Note:** まとめとして、この章では基本概念を学びました。`,
			title: "サンプル書籍タイトル",
			author: "サンプル著者",
			authorUrl: "https://amazon.com/author/sample",
			imageUrl: "https://m.media-amazon.com/images/I/sample.jpg",
			highlightsCount: 3,
			lastAnnotatedDate: "2024年1月15日",
			publicationDate: "2023年12月1日",
			publisher: "サンプル出版社",
			url: "https://amazon.com/dp/B001234567",
			appLink: "kindle://book?action=open&asin=B001234567",
			asin: "B001234567"
		};
	}

	private addCodeExampleHelper(
		container: HTMLElement,
		title: string, // Title for example is already translated before calling
		code: string
	): void {
		const exampleDiv = container.createEl("div");
		exampleDiv.createEl("h4", { text: title }); // Use the passed (translated) title
		const pre = exampleDiv.createEl("pre");
		pre.createEl("code", { text: code });
	}
}
