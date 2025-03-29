// services/template-renderer.ts
import { Book, Highlight } from "../models";

interface TemplateContext {
	book: Book;
	highlights: Highlight[];
	[key: string]: any;
}

/**
 * シンプルなテンプレートエンジン
 * Mustacheに似た構文でテンプレートをレンダリング
 */
export function renderTemplate(
	template: string,
	context: TemplateContext
): string {
	let result = template;

	// 基本的な変数置換
	// {{variable}} 形式の置換
	result = replaceVariables(result, context);

	// セクション処理
	// {{#section}}...{{/section}} 形式の処理
	result = processSections(result, context);

	return result;
}

/**
 * テンプレート内の変数を置換
 */
function replaceVariables(
	template: string,
	context: Record<string, any>,
	prefix = ""
): string {
	let result = template;

	// オブジェクトの各プロパティを処理
	for (const [key, value] of Object.entries(context)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;

		if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			// ネストされたオブジェクトを再帰的に処理
			result = replaceVariables(result, value, fullKey);
		} else if (!Array.isArray(value)) {
			// 配列以外の値を置換
			const regex = new RegExp(`{{\\s*${fullKey}\\s*}}`, "g");
			result = result.replace(
				regex,
				value !== undefined ? String(value) : ""
			);
		}
	}

	return result;
}

/**
 * テンプレート内のセクションを処理
 */
function processSections(
	template: string,
	context: Record<string, any>
): string {
	let result = template;

	// セクション開始と終了のパターン
	const sectionPattern = /{{#([^}]+)}}([\s\S]*?){{\/\1}}/g;

	// すべてのセクションを処理
	let match;
	while ((match = sectionPattern.exec(template)) !== null) {
		const [fullMatch, sectionName, sectionContent] = match;
		const value = resolveValue(context, sectionName);

		let replacement = "";

		if (Array.isArray(value)) {
			// 配列の場合、各要素に対してセクションを繰り返し
			replacement = value
				.map((item) => {
					// 各アイテムをコンテキストとしてセクション内容をレンダリング
					let itemContent = replaceVariables(sectionContent, item);
					itemContent = processSections(itemContent, item);
					return itemContent;
				})
				.join("");
		} else if (value) {
			// 真値の場合、セクションをそのまま表示
			replacement = sectionContent;
		}

		// 元のテンプレートを置換
		result = result.replace(fullMatch, replacement);
	}

	return result;
}

/**
 * ドット記法でネストされた値を取得
 */
function resolveValue(obj: Record<string, any>, path: string): any {
	const keys = path.split(".");
	let current = obj;

	for (const key of keys) {
		if (current === null || current === undefined) {
			return undefined;
		}
		current = current[key];
	}

	return current;
}

/**
 * サンプル使用方法:
 *
 * const book = {
 *   title: "My Book",
 *   author: "John Doe"
 * };
 *
 * const highlights = [
 *   { text: "This is highlight 1" },
 *   { text: "This is highlight 2" }
 * ];
 *
 * const template = `
 * # {{title}} by {{author}}
 *
 * ## Highlights
 *
 * {{#highlights}}
 * - {{text}}
 * {{/highlights}}
 * `;
 *
 * const rendered = renderTemplate(template, { book, highlights });
 */
