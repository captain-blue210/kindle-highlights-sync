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
	const momentLocale = moment.locale();
	const targetLocale = locale || momentLocale;

	currentLocale = locales[targetLocale] ? targetLocale : "en"; // Fallback to 'en'
	console.log(`Kindle Highlights: Selected currentLocale: ${currentLocale}`);

	try {
		console.log(
			`Kindle Highlights: Attempting to load translations for ${currentLocale}`
		);
		const module = await locales[currentLocale]();
		translations = module.default || module;
		console.log(
			`Kindle Highlights: Loaded translations for ${currentLocale}:`,
			Object.keys(translations).length,
			"keys"
		);
		console.log(
			`Kindle Highlights: Loaded translations object:`,
			translations
		);

		// Check if Amazon region translations exist
		if (
			typeof translations === "object" &&
			translations !== null &&
			"settings" in translations &&
			typeof translations.settings === "object" &&
			translations.settings !== null &&
			"amazonRegion" in translations.settings &&
			typeof translations.settings.amazonRegion === "object" &&
			translations.settings.amazonRegion !== null &&
			"regions" in translations.settings.amazonRegion
		) {
			console.log(
				`Kindle Highlights: Amazon region translations found:`,
				translations.settings.amazonRegion.regions
			);
		} else {
			console.warn(
				`Kindle Highlights: Amazon region translations NOT found in loaded translations`
			);
		}
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
	// Only log for Amazon region keys to reduce noise
	const isAmazonRegionKey = key.includes("settings.amazonRegion.regions");

	if (isAmazonRegionKey) {
		console.log(`Kindle Highlights: resolveKey called with key: "${key}"`);
	}

	if (typeof obj !== "object" || obj === null) {
		if (isAmazonRegionKey) {
			console.log(
				`Kindle Highlights: resolveKey returning undefined - obj is not object or is null`
			);
		}
		return undefined;
	}

	// Special handling for Amazon region keys to preserve dots in region names
	if (key.startsWith("settings.amazonRegion.regions.")) {
		const regionKey = key.replace("settings.amazonRegion.regions.", "");
		const result = (obj as any).settings?.amazonRegion?.regions?.[
			regionKey
		];

		if (isAmazonRegionKey) {
			console.log(
				`Kindle Highlights: Amazon region special handling - regionKey: "${regionKey}", result:`,
				result
			);
		}

		return result;
	}

	const keyParts = key.split(".");

	const result = keyParts.reduce((acc, part, index) => {
		if (typeof acc === "object" && acc !== null && part in acc) {
			const nextValue = acc[part] as string | Translations;
			return nextValue;
		}
		if (isAmazonRegionKey) {
			console.log(
				`Kindle Highlights: resolveKey step ${index}: "${part}" not found in acc`
			);
		}
		return undefined;
	}, obj as Translations);

	if (isAmazonRegionKey) {
		console.log(`Kindle Highlights: resolveKey final result:`, result);
	}
	return result;
}

export function t(
	key: string,
	params?: Record<string, string | number>
): string {
	// Only log for Amazon region keys to reduce noise
	const isAmazonRegionKey = key.includes("settings.amazonRegion.regions");

	if (isAmazonRegionKey) {
		console.log(`Kindle Highlights: t() called with key: "${key}"`);
		console.log(`Kindle Highlights: Current locale: "${currentLocale}"`);
	}

	let translation = resolveKey(key, translations);

	if (isAmazonRegionKey) {
		console.log(
			`Kindle Highlights: resolveKey result for "${key}":`,
			translation
		);
	}

	if (typeof translation !== "string") {
		// If the key wasn't found, or if it resolved to an object (partial key),
		// log a warning and return the key itself.
		if (isAmazonRegionKey) {
			console.warn(
				`Kindle Highlights: Translation not found for key "${key}" in locale "${currentLocale}". Returning key.`
			);
			console.warn(
				`Kindle Highlights: Translation object type:`,
				typeof translation
			);
		}
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

	if (isAmazonRegionKey) {
		console.log(
			`Kindle Highlights: Final translation for "${key}": "${translation}"`
		);
	}
	return translation as string; // Cast to string, as we return the key if not found
}

// Debug functions to expose internal state
export function getCurrentLocale(): string {
	return currentLocale;
}

export function getTranslations(): Translations {
	return translations;
}
