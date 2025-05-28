// src/i18n.ts
import { moment } from "obsidian";

interface Translations {
	[key: string]: string | Translations;
}

let translations: Translations = {};
let currentLocale = "en"; // Default locale

// Define available locales and a way to load them.
// Using dynamic imports for locales to allow for code splitting if desired,
// and to avoid loading all languages at once.
const locales: Record<string, () => Promise<{ default: Translations }>> = {
	en: async () => await import("./locales/en.json"),
	ja: async () => await import("./locales/ja.json"),
};

export async function loadTranslations(locale?: string): Promise<void> {
	const targetLocale = locale || moment.locale();
	currentLocale = locales[targetLocale] ? targetLocale : "en"; // Fallback to 'en'

	try {
		const module = await locales[currentLocale]();
		translations = module.default || module;
		console.log(
			`Kindle Highlights: Loaded translations for ${currentLocale}:`,
			Object.keys(translations).length,
			"keys"
		);
	} catch (e) {
		console.error(
			`Kindle Highlights: Failed to load translations for ${currentLocale}, falling back to en.`,
			e
		);
		currentLocale = "en"; // Ensure fallback on error
		try {
			const module = await locales.en();
			translations = module.default;
		} catch (fallbackError) {
			console.error(
				`Kindle Highlights: Failed to load fallback English translations.`,
				fallbackError
			);
			translations = {}; // Empty translations if English also fails
		}
	}
}

// Helper function to resolve nested keys (e.g., "settings.title")
function resolveKey(
	key: string,
	obj: Translations | string | undefined
): string | Translations | undefined {
	if (typeof obj !== "object" || obj === null) return undefined;
	return key.split(".").reduce((acc, part) => {
		if (typeof acc === "object" && acc !== null && part in acc) {
			return acc[part] as string | Translations;
		}
		return undefined;
	}, obj as Translations);
}

export function t(
	key: string,
	params?: Record<string, string | number>
): string {
	let translation = resolveKey(key, translations);

	if (typeof translation !== "string") {
		// If the key wasn't found, or if it resolved to an object (partial key),
		// log a warning and return the key itself.
		console.warn(
			`Kindle Highlights: Translation not found for key "${key}" in locale "${currentLocale}". Returning key.`
		);
		translation = key;
	} else if (params) {
		// Perform replacements if params are provided
		for (const paramKey in params) {
			// Ensure global replacement for multiple occurrences of the same placeholder
			translation = translation.replace(
				new RegExp(`{{${paramKey}}}`, "g"),
				String(params[paramKey])
			);
		}
	}
	return translation as string; // Cast to string, as we return the key if not found
}
