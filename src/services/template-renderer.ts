// services/template-renderer.ts
import * as nunjucks from "nunjucks";
// Removed: import { Notice } from "obsidian";
import { Book } from "../models";

// Configure Nunjucks (optional, but good practice)
// - autoescape: false - Assuming templates are trusted and contain Markdown/HTML
// - trimBlocks: true - Removes the first newline after a block tag
// - lstripBlocks: true - Strips leading whitespace from a block tag
const nunjucksEnv = new nunjucks.Environment(null, {
	autoescape: false,
	trimBlocks: true,
	lstripBlocks: true,
});

// Define the expected structure of the data passed to the template
// Note: The 'highlights' key in the template expects a pre-rendered string,
// so we might adjust this interface or the data preparation logic later if needed.
interface TemplateContext {
	book: Book;
	highlights: string; // Changed from Highlight[] as the template expects a string
	// Add other top-level variables expected by the template
	title: string;
	author: string;
	authorUrl?: string;
	imageUrl?: string;
	highlightsCount?: number;
	lastAnnotatedDate?: string;
	publicationDate?: string;
	publisher?: string;
	url?: string;
	appLink?: string;
	// Allow any other properties potentially added dynamically
	[key: string]: any;
}

/**
 * Renders a template string using Nunjucks.
 *
 * @param template The Nunjucks template string.
 * @param context The data object to use for rendering.
 * @returns The rendered string.
 * @throws Error if rendering fails.
 */
export function renderTemplate(
	template: string,
	context: TemplateContext
): string {
	try {
		// Use the configured Nunjucks environment to render the string
		const rendered = nunjucksEnv.renderString(template, context);
		return rendered;
	} catch (error) {
		console.error("Error rendering Nunjucks template:", error);
		// Re-throw the error to be handled by the caller
		throw new Error(`Template rendering failed: ${error.message || error}`);
	}
}

// --- Removed custom template functions ---
// replaceVariables, processSections, resolveValue are no longer needed.
