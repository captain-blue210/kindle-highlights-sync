import * as cheerio from "cheerio";
import { Notice, requestUrl } from "obsidian";
import type { AmazonSession } from "../modals/AmazonLoginModal"; // Assuming session structure
import { Book, Highlight } from "../models";

// --- Constants ---
// Standard User Agent to mimic a browser
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36";
// Base URL for Kindle Cloud Reader Notebook
const BASE_URL = "https://read.amazon.";

// --- CSS Selectors ---
// IMPORTANT: These selectors are based on the observed structure of the Kindle Cloud Reader
// notebook page as of the time of writing. Amazon may change its website structure
// at any time, which WILL BREAK this scraping logic. Regular maintenance and updates
// to these selectors will likely be required.
const BOOK_SELECTOR = ".kp-notebook-library-each-book"; // Selector for each book entry in the sidebar
const BOOK_ASIN_ATTR = "data-asin";
const BOOK_TITLE_SELECTOR = ".kp-notebook-library-book-title";
const BOOK_AUTHOR_SELECTOR = ".kp-notebook-library-book-author";
const BOOK_COVER_SELECTOR = "img.kp-notebook-cover-image"; // Check if this selector is correct

// IMPORTANT: Like book selectors, these highlight selectors are fragile and subject to change by Amazon.
const HIGHLIGHT_CONTAINER_SELECTOR =
	".a-row.a-spacing-base.kp-notebook-highlight"; // Container for a single highlight + note
const HIGHLIGHT_TEXT_SELECTOR = "#highlight"; // ID for the highlight text itself
const HIGHLIGHT_NOTE_SELECTOR = "#note"; // ID for the user's note on the highlight
const HIGHLIGHT_LOCATION_SELECTOR = "#annotationHighlightHeader"; // Contains location info (needs parsing)
const HIGHLIGHT_ASIN_ATTR = "data-asin"; // Assuming the container has the book ASIN

/**
 * Scrapes books and highlights from the Kindle Cloud Reader notebook page.
 * Requires a valid AmazonSession with cookies.
 */
export async function scrapeKindleHighlights(
	region: string,
	session: AmazonSession // Changed from credentials to session
): Promise<{ books: Book[]; highlights: Highlight[] }> {
	const notebookUrl = `${BASE_URL}${region}/notebook`;
	console.log(`Attempting to scrape Kindle notebook: ${notebookUrl}`);

	try {
		const response = await requestUrl({
			url: notebookUrl,
			method: "GET",
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
				"Accept-Language": "en-US,en;q=0.9",
				Cookie: session.cookies, // Use cookies from the authenticated session
				// Add other headers if necessary based on browser inspection
			},
			throw: false, // Handle errors manually
		});

		console.log(`Scraping response status: ${response.status}`);

		// Check for potential redirect to login page (indicating invalid session)
		if (response.status >= 300 && response.status < 400) {
			// Check response headers for location pointing to signin
			const location = response.headers["location"];
			if (location && location.includes("/ap/signin")) {
				throw new Error(
					"Authentication failed or session expired. Please log in again."
				);
			}
		}

		if (response.status !== 200) {
			throw new Error(
				`Failed to fetch Kindle Notebook page. Status: ${response.status}`
			);
		}

		const html = response.text;
		const $ = cheerio.load(html);

		const books: Book[] = [];
		const highlights: Highlight[] = [];

		// --- Parse Books ---
		$(BOOK_SELECTOR).each((_index, element) => {
			const bookElement = $(element);
			const id = bookElement.attr(BOOK_ASIN_ATTR);
			const title = bookElement.find(BOOK_TITLE_SELECTOR).text()?.trim();
			const author =
				bookElement
					.find(BOOK_AUTHOR_SELECTOR)
					.text()
					?.trim()
					.replace(/^By\s+/i, "") || // Remove "By " prefix
				"Unknown Author"; // Provide default if author not found
			const coverUrl = bookElement.find(BOOK_COVER_SELECTOR).attr("src");

			if (id && title) {
				books.push({
					id,
					title,
					author,
					// coverUrl, // Add if needed and selector is correct
					// metadata: {}, // Initialize metadata if needed later
				});
			} else {
				console.warn(
					"Skipping book element due to missing ID or Title:",
					bookElement.html()
				);
			}
		});
		console.log(`Parsed ${books.length} books.`);

		// --- Parse Highlights ---
		// Assuming highlights for all books are present on the page
		$(HIGHLIGHT_CONTAINER_SELECTOR).each((_index, element) => {
			const highlightElement = $(element);
			const bookId = highlightElement.attr(HIGHLIGHT_ASIN_ATTR); // Get associated book ASIN
			const text = highlightElement
				.find(HIGHLIGHT_TEXT_SELECTOR)
				.text()
				?.trim();
			const note =
				highlightElement.find(HIGHLIGHT_NOTE_SELECTOR).text()?.trim() ||
				undefined; // Note is optional
			const locationHeader = highlightElement
				.find(HIGHLIGHT_LOCATION_SELECTOR)
				.text()
				?.trim();

			// Basic parsing for location and page (might need refinement)
			const location = locationHeader || "Unknown Location";
			let page: number | undefined;
			const pageMatch = location.match(/page (\d+)/i);
			if (pageMatch) {
				page = parseInt(pageMatch[1], 10);
			}

			// Generate a simple ID for the highlight (KCR might not provide stable ones)
			const id = `highlight-${bookId}-${_index}`; // Simple index-based ID

			if (bookId && text) {
				highlights.push({
					id,
					bookId,
					text,
					location,
					page,
					note,
					// createdAt: undefined, // Date parsing is complex from HTML, skip for now
				});
			} else {
				console.warn(
					"Skipping highlight element due to missing Book ID or Text:",
					highlightElement.html()
				);
			}
		});
		console.log(`Parsed ${highlights.length} highlights.`);

		if (books.length === 0 && highlights.length === 0) {
			console.warn(
				"No books or highlights found on the notebook page. Is the page structure correct or has it changed?"
			);
			// Show a notice if the page seems empty but login was successful
			new Notice(
				"Could not find any books or highlights on the Kindle Notebook page. The page structure might have changed, or there might be no highlights."
			);
		}

		return { books, highlights };
	} catch (error) {
		console.error("Error scraping Kindle highlights:", error);
		new Notice(`Error scraping Kindle highlights: ${error.message}`);
		// Re-throw or return empty to allow sync process to handle failure
		throw error; // Or return { books: [], highlights: [] };
	}
}
