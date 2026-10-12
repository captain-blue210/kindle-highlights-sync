import type * as cheerio from "cheerio";
import type { Book, Highlight } from "../models";
import { parseAuthor, parseToDateString } from "./kindle-api"; // Import helpers from kindle-api

// --- CSS Selectors --- (Moved from kindle-api.ts)
/** Notebook memos contain HTML; retain their paragraph, line and link structure. */
export function memoMarkdown(
	$: cheerio.Root,
	element: cheerio.Element,
): string {
	const escape = (text: string) => text.replace(/([\\`*_[\]<>])/g, "\\$1");
	const visit = (node: any): string => {
		if (node.type === "text") return escape(node.data ?? "");
		if (["script", "style"].includes(node.name)) return "";
		if (node.name === "br") return "\n";
		const text = (node.children ?? []).map(visit).join("");
		if (node.name === "a") {
			const href = $(node).attr("href") ?? "";
			if (/^(https?:|mailto:|kindle:)/i.test(href))
				return `[${text || escape(href)}](${href.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
		}
		if (["p", "div"].includes(node.name)) return `\n\n${text}\n\n`;
		return text;
	};
	return visit(element)
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
const BOOK_SELECTOR = ".kp-notebook-library-each-book"; // Main container for each book
const BOOK_TITLE_SELECTOR = "h2.kp-notebook-metadata"; // Corrected selector based on test HTML
const BOOK_AUTHOR_SELECTOR = "p.kp-notebook-metadata"; // Corrected selector based on test HTML
const BOOK_IMAGE_SELECTOR = ".kp-notebook-cover-image";
const BOOK_LAST_ANNOTATED_SELECTOR = '[id^="kp-notebook-annotated-date"]';
const BOOK_URL_SELECTOR = "a.kp-notebook-read-more-link"; // Selector for the book's notebook link

const HIGHLIGHT_CONTAINER_SELECTOR = ".a-row.a-spacing-base"; // Base row for highlight/note pair
const HIGHLIGHT_TEXT_SELECTOR = "#highlight"; // ID for highlight text span
const HIGHLIGHT_NOTE_SELECTOR = "#note"; // ID for note text span
const HIGHLIGHT_LOCATION_SELECTOR = "#kp-annotation-location"; // ID for hidden input with location value
const HIGHLIGHT_COLOR_SELECTOR = ".kp-notebook-highlight"; // Class on the highlight span indicating color

export type ExcludedBookRow = {
	row: number;
	asin?: string;
	reason: "missing-asin" | "missing-title" | "duplicate-asin";
};

// --- Color Mapping --- (Moved from kindle-api.ts)
const mapTextToColor = (
	highlightClasses: string | undefined,
): Highlight["color"] => {
	if (!highlightClasses) return undefined;
	// Regex to extract color name (e.g., "yellow") from class like "kp-notebook-highlight-yellow"
	const matches = /kp-notebook-highlight-(.*)/.exec(highlightClasses);
	return matches ? (matches[1] as Highlight["color"]) : undefined;
};

export class HighlightParser {
	/**
	 * Parses the main Kindle Notebook page (/notebook) to extract book metadata.
	 * Does not extract highlights themselves.
	 * @param $ CheerioAPI instance for the notebook page HTML.
	 * @param region The Amazon region code (used for date parsing).
	 * @returns An array of Book objects with metadata.
	 */
	public parseNotebookPage($: cheerio.Root, region: string): Book[] {
		return this.parseNotebookWithDiagnostics($, region).books;
	}

	public parseNotebookWithDiagnostics($: cheerio.Root, region: string) {
		const books: Book[] = [];
		const notebookAsins = new Set<string>();
		const parsedAsins = new Set<string>();
		const excludedRows: ExcludedBookRow[] = [];

		$(BOOK_SELECTOR).each((_index: number, element: cheerio.Element) => {
			const bookElement = $(element);

			// ASIN is usually the element ID in the test/real HTML structure.
			const elementId = bookElement.attr("id"); // e.g., "BOOK_ASIN_1"
			let asin = elementId?.trim(); // Directly use the ID as the ASIN

			// Try finding title with the primary selector, then fallback to the other common one
			let title = bookElement.find(BOOK_TITLE_SELECTOR).text()?.trim();
			if (!title) {
				// Fallback selector seen in some test cases/potentially real-world
				title = bookElement
					.find("h2.kp-notebook-searchable")
					.text()
					?.trim();
			}

			// Similarly, try both selectors for author
			let authorText = bookElement
				.find(BOOK_AUTHOR_SELECTOR)
				.text()
				?.trim();
			if (!authorText) {
				// Fallback selector
				authorText = bookElement
					.find("p.kp-notebook-searchable")
					.text()
					?.trim();
			}
			const author = parseAuthor(authorText); // Use imported helper
			const imageUrl = bookElement.find(BOOK_IMAGE_SELECTOR).attr("src");
			const dateElement = bookElement.find(BOOK_LAST_ANNOTATED_SELECTOR);
			const lastAnnotatedText =
				(dateElement.val() as string | undefined) ||
				dateElement.text()?.trim();
			const lastAnnotatedDate = parseToDateString(
				lastAnnotatedText,
				region,
			); // Use imported helper
			const bookUrl = bookElement.find(BOOK_URL_SELECTOR).attr("href");

			// Fallback to URL extraction only if ID didn't provide ASIN
			if (!asin && bookUrl) {
				try {
					const url = new URL(bookUrl); // Use URL constructor for robustness
					asin = url.searchParams.get("asin") ?? undefined;
				} catch (e) {
					console.warn(
						"Could not parse book URL for ASIN fallback:",
						bookUrl,
						e,
					);
				}
			}

			if (asin) notebookAsins.add(asin);
			if (asin && title && !parsedAsins.has(asin)) {
				parsedAsins.add(asin);
				books.push({
					id: asin, // Use ASIN as the primary ID
					asin: asin,
					title: title,
					author: author,
					url: bookUrl, // Store the notebook URL for the book
					imageUrl: imageUrl,
					lastAnnotatedDate: lastAnnotatedDate,
					// highlights array will be populated later
				});
			} else {
				excludedRows.push({
					row: _index + 1,
					...(asin ? { asin } : {}),
					reason: !asin
						? "missing-asin"
						: !title
							? "missing-title"
							: "duplicate-asin",
				});
			}
		});

		return {
			books,
			notebookAsins: Array.from(notebookAsins),
			excludedRows,
		};
	}

	/**
	 * Parses a single page of highlights for a specific book.
	 * @param $ CheerioAPI instance for the highlights page HTML.
	 * @param bookAsin The ASIN of the book these highlights belong to.
	 * @returns An array of Highlight objects found on the page.
	 */
	public parseHighlightsPage($: cheerio.Root, bookAsin: string): Highlight[] {
		const highlightsEl = $(HIGHLIGHT_CONTAINER_SELECTOR).toArray();
		const highlights: Highlight[] = [];
		const consumedNotes = new Set<cheerio.Element>();

		highlightsEl.forEach((highlightContainerEl: cheerio.Element) => {
			const container = $(highlightContainerEl);
			if (consumedNotes.has(highlightContainerEl) || container.parents(HIGHLIGHT_CONTAINER_SELECTOR).toArray().some(el => consumedNotes.has(el))) return;
			// Nested layout rows belong to their closest annotation row.
			const owned = (selector: string) =>
				container
					.find(selector)
					.filter(
						(_i, el) =>
							$(el).closest(HIGHLIGHT_CONTAINER_SELECTOR)[0] ===
							highlightContainerEl,
					);

			// Find elements within the current container
			const textElement = owned(HIGHLIGHT_TEXT_SELECTOR);
			const locationElement = owned(HIGHLIGHT_LOCATION_SELECTOR);
			const colorElement = container.find(HIGHLIGHT_COLOR_SELECTOR); // Find the span with the color class

			const text = textElement.text()?.trim() || "";
			const notes = owned(HIGHLIGHT_NOTE_SELECTOR)
				.toArray()
				.map((el) => memoMarkdown($, el))
				.filter(Boolean);
			const sibling = container.next(".kp-notebook-note");
			const siblingLocation = sibling
				.find(HIGHLIGHT_LOCATION_SELECTOR)
				.val();
			const ownLocation = locationElement.val();
			if (
				text &&
				sibling.length &&
				(!siblingLocation ||
					(ownLocation && siblingLocation === ownLocation))
			) {
				notes.push(
					...sibling
						.find(HIGHLIGHT_NOTE_SELECTOR)
						.toArray()
						.map((el) => memoMarkdown($, el))
						.filter(Boolean),
				);
				consumedNotes.add(sibling[0]);
			}
			const distinctNotes = [...new Set(notes)];
			if (!text && !distinctNotes.length) return;

			// Location is stored in a hidden input's value attribute
			const locationValue = locationElement.val() as string;
			// Extract the numeric part if it exists (e.g., "Location 1234" -> "1234")
			// Handle cases where it might just be a number or missing
			let location: string | undefined;
			let locationNumber: number | undefined;
			if (locationValue) {
				const locationMatch = locationValue.match(/\d+$/); // Match digits at the end
				if (locationMatch) {
					location = locationMatch[0];
					locationNumber = parseInt(location, 10);
				} else if (!isNaN(Number(locationValue))) {
					// Check if it's just a number string
					location = locationValue;
					locationNumber = parseInt(locationValue, 10);
				} else {
					location = locationValue; // Keep original string if no number found
				}
			}

			// Page number extraction (keep as is, assuming selector is correct if needed)
			const pageText = container // Use 'container' instead of 'element'
				.find(".kp-annotation-page-text") // Assuming this selector exists if needed
				.text()
				?.trim();
			const pageMatch = pageText?.match(/page (\d+)/i);
			const page = pageMatch ? parseInt(pageMatch[1], 10) : undefined;

			const highlightClasses = colorElement.attr("class");
			const color = mapTextToColor(highlightClasses);

			// Generate ID based on ASIN and location (if available) or text snippet
			const idSuffix = location
				? `loc-${location}`
				: `text-${(text || distinctNotes[0]).substring(0, 10).replace(/\s+/g, "-")}`;
			const id = `highlight-${bookAsin}-${idSuffix}`;

			// Generate appLink
			const appLink = locationNumber
				? `kindle://book?action=open&asin=${bookAsin}&location=${locationNumber}`
				: undefined;

			highlights.push({
				id,
				sourceAnnotationId: container.attr("id") || undefined,
				sourceHighlightId: colorElement.attr("id") || undefined,
				bookId: bookAsin,
				text,
				color,
				location: locationValue, // Store the original location string
				page,
				note: distinctNotes[0],
				...(distinctNotes.length > 1 ? { notes: distinctNotes } : {}),
				appLink, // Add the generated app link
			});
		});

		return highlights;
	}
}
