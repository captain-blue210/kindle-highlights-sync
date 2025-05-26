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

		// Create editor and preview grid
		const editorPreviewGrid = templateEditorLayout.createDiv({
			cls: "kindle-editor-preview-grid",
		});

		// Editor column
		const editorColumn = editorPreviewGrid.createDiv({
			cls: "kindle-template-editor-column",
		});

		editorColumn.createEl("h4", {
			text: t("settings.noteTemplate.title"),
			cls: "kindle-column-header",
		});

		const templateTextarea = editorColumn.createEl("textarea", {
			cls: "kindle-template-editor-textarea",
		});
		templateTextarea.value = this.plugin.settings.templateContent;

		const resetButton = editorColumn.createEl("button", {
			text: t("settings.noteTemplate.resetButton"),
			cls: "kindle-template-editor-button",
		});

		// Preview column
		const previewColumn = editorPreviewGrid.createDiv({
			cls: "kindle-template-preview-column",
		});

		previewColumn.createEl("h4", {
			text: t("settings.noteTemplate.preview.title"),
			cls: "kindle-column-header",
		});

		const previewContent = previewColumn.createDiv({
			cls: "kindle-template-preview-content",
		});

		// Function to update preview
		const updatePreview = () => {
			try {
				const sampleData = this.generateSampleData();
				const rendered = renderTemplate(templateTextarea.value, sampleData);
				previewContent.innerHTML = this.convertMarkdownToHTML(rendered);
			} catch (error) {
				previewContent.innerHTML = `<div class="kindle-preview-error">${t("settings.noteTemplate.preview.error", { error: error.message })}</div>`;
			}
		};

		// Event listeners
		templateTextarea.addEventListener("input", async (e) => {
			this.plugin.settings.templateContent = (
				e.target as HTMLTextAreaElement
			).value;
			await this.plugin.saveSettings();
			updatePreview();
		});

		resetButton.addEventListener("click", async () => {
			templateTextarea.value = DEFAULT_SETTINGS.templateContent;
			this.plugin.settings.templateContent =
				DEFAULT_SETTINGS.templateContent;
			await this.plugin.saveSettings();
			updatePreview();
		});

		// Initial preview update
		updatePreview();

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
				updatePreview();
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
			}
			.kindle-editor-preview-grid {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 20px;
				margin-bottom: 25px;
			}
			.kindle-template-editor-column {
				display: flex;
				flex-direction: column;
			}
			.kindle-template-preview-column {
				display: flex;
				flex-direction: column;
			}
			.kindle-column-header {
				margin: 0 0 10px 0;
				font-size: 1em;
				font-weight: 600;
				color: var(--text-normal);
				border-bottom: 1px solid var(--background-modifier-border);
				padding-bottom: 5px;
			}
			.kindle-template-variables-column {
				max-height: 450px; 
				overflow-y: auto;
				overflow-x: auto; 
				border-top: 1px solid var(--background-modifier-border); 
				padding-top: 15px; 
				padding-right: 10px;
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
			.kindle-template-preview-content {
				width: 100%;
				height: 300px;
				padding: 15px;
				border: 1px solid var(--background-modifier-border);
				border-radius: 4px;
				background-color: var(--background-primary);
				color: var(--text-normal);
				overflow-y: auto;
				font-family: var(--font-text);
				line-height: 1.6;
			}
			.kindle-template-preview-content h1 {
				font-size: 1.8em;
				font-weight: 600;
				margin: 0.5em 0;
				color: var(--text-normal);
			}
			.kindle-template-preview-content h2 {
				font-size: 1.5em;
				font-weight: 600;
				margin: 0.4em 0;
				color: var(--text-normal);
			}
			.kindle-template-preview-content h3 {
				font-size: 1.3em;
				font-weight: 600;
				margin: 0.3em 0;
				color: var(--text-normal);
			}
			.kindle-template-preview-content blockquote {
				border-left: 4px solid var(--text-accent);
				margin: 1em 0;
				padding: 0.5em 1em;
				background-color: var(--background-secondary);
				font-style: italic;
			}
			.kindle-template-preview-content ul {
				margin: 0.5em 0;
				padding-left: 1.5em;
			}
			.kindle-template-preview-content li {
				margin: 0.2em 0;
			}
			.kindle-template-preview-content a {
				color: var(--text-accent);
				text-decoration: none;
			}
			.kindle-template-preview-content a:hover {
				text-decoration: underline;
			}
			.kindle-template-preview-content strong {
				font-weight: 600;
			}
			.kindle-template-preview-content em {
				font-style: italic;
			}
			.kindle-preview-error {
				color: var(--text-error);
				background-color: var(--background-modifier-error);
				padding: 10px;
				border-radius: 4px;
				border: 1px solid var(--text-error);
				font-family: monospace;
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

	private generateSampleData(): any {
		return {
			title: "コンテナ物語―世界を変えたモノの箱の歴史",
			author: "マルク・レビンソン",
			authorUrl: "https://www.amazon.co.jp/author/marc-levinson",
			imageUrl: "https://example.com/book-cover.jpg",
			highlightsCount: 15,
			lastAnnotatedDate: "2024-12-20",
			publicationDate: "2007-05-25",
			publisher: "日経BP社",
			url: "https://www.amazon.co.jp/dp/B00B3GDRM8",
			appLink: "kindle://book?action=open&asin=B00B3GDRM8",
			asin: "B00B3GDRM8",
			highlights: `### 位置 123-125
コンテナは単なる箱ではない。それは世界経済の動脈である。

### 位置 456-458
標準化がもたらした革命は、運送業界だけでなく、製造業、小売業、そして私たちの日常生活にまで及んでいる。

### 位置 789-791
> 効率性の追求が、時として人間的な要素を置き去りにしてしまうのは皮肉なことである。

**メモ:** この観点は現代のデジタル化にも当てはまる重要な指摘だと思う。`,
		};
	}

	private convertMarkdownToHTML(markdown: string): string {
		// Simple markdown to HTML conversion for preview
		// This is a basic implementation - in a real app you might use a proper markdown parser
		let html = markdown;
		
		// Headers
		html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
		html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
		html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
		
		// Bold
		html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
		
		// Italic
		html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
		
		// Links
		html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
		
		// Blockquotes
		html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
		
		// Lists
		html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
		html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
		
		// Line breaks
		html = html.replace(/\n/g, '<br>');
		
		// Images
		html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; height: auto;">');
		
		return html;
	}
}
