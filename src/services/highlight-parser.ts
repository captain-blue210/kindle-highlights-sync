import type { Book, Highlight } from "../models";
import { parseAuthor, parseToDateString } from "./kindle-api"; // Import helpers from kindle-api

// --- CSS Selectors --- (Moved from kindle-api.ts)
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

// --- Color Mapping --- (Moved from kindle-api.ts)
const mapTextToColor = (
	highlightClasses: string | undefined
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
		const books: Book[] = [];

		$(BOOK_SELECTOR).each((_index: number, element: cheerio.Element) => {
			const bookElement = $(element);

			// ASIN is usually the element ID in the test/real HTML structure.
			const elementId = bookElement.attr("id"); // e.g., "BOOK_ASIN_1"
			let asin = elementId; // Directly use the ID as the ASIN

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
			const lastAnnotatedText = bookElement
				.find(BOOK_LAST_ANNOTATED_SELECTOR)
				.text()
				?.trim();
			const lastAnnotatedDate = parseToDateString(
				lastAnnotatedText,
				region
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
						e
					);
				}
			}

			if (asin && title) {
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
				console.warn(
					"Skipping book element due to missing ASIN or Title:",
					bookElement.html()
				);
			}
		});

		return books;
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

		highlightsEl.forEach((highlightContainerEl: cheerio.Element) => {
			const container = $(highlightContainerEl);

			// Find elements within the current container
			const textElement = container.find(HIGHLIGHT_TEXT_SELECTOR);
			const locationElement = container.find(HIGHLIGHT_LOCATION_SELECTOR);
			const colorElement = container.find(HIGHLIGHT_COLOR_SELECTOR); // Find the span with the color class

			const text = textElement.text()?.trim();
			if (!text) {
				// Skip if no highlight text found - this container might be just a note or empty
				return;
			}

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
			// Find the associated note, which is usually the next sibling element
			const noteElement = container.next(".kp-notebook-note"); // Look for the note sibling
			const noteHtml = noteElement?.find(HIGHLIGHT_NOTE_SELECTOR).html(); // Find the text within the sibling
			const note = noteHtml ? noteHtml.trim() : undefined;

			// Generate ID based on ASIN and location (if available) or text snippet
			const idSuffix = location
				? `loc-${location}`
				: `text-${text.substring(0, 10).replace(/\s+/g, "-")}`;
			const id = `highlight-${bookAsin}-${idSuffix}`;

			// Generate appLink
			const appLink = locationNumber
				? `kindle://book?action=open&asin=${bookAsin}&location=${locationNumber}`
				: undefined;

			highlights.push({
				id,
				bookId: bookAsin,
				text,
				color,
				location: locationValue, // Store the original location string
				page,
				note,
				appLink, // Add the generated app link
			});
		});

		return highlights;
	}
}
