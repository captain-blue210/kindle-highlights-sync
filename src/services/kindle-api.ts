import moment from "moment"; // Revert to default import
import { App, Notice } from "obsidian"; // Keep App, Notice
import { AmazonLoginModal } from "../modals/AmazonLoginModal"; // Import the modal
import { Book, Highlight } from "../models";
import { loadRemoteDom } from "../utils/remote-loader"; // Add loadRemoteDom

// --- Region URL Definitions --- (Keep outside class for now)

interface AmazonRegionUrls {
	loginUrl: string;
	cloudReaderUrl: string;
	notebookUrl: string;
	logoutUrl: string; // Added logout URL
}

const REGION_URLS: Record<string, AmazonRegionUrls> = {
	com: {
		loginUrl:
			"https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.com%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_us&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.com/",
		notebookUrl: "https://read.amazon.com/notebook",
		logoutUrl: "https://www.amazon.com/gp/flex/sign-out.html", // Standard logout URL
	},
	"co.jp": {
		loginUrl:
			"https://www.amazon.co.jp/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.co.jp%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_jp&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.co.jp/",
		notebookUrl: "https://read.amazon.co.jp/notebook",
		logoutUrl: "https://www.amazon.co.jp/gp/flex/sign-out.html",
	},
	"co.uk": {
		loginUrl:
			"https://www.amazon.co.uk/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.co.uk%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_uk&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.co.uk/",
		notebookUrl: "https://read.amazon.co.uk/notebook",
		logoutUrl: "https://www.amazon.co.uk/gp/flex/sign-out.html",
	},
	de: {
		loginUrl:
			"https://www.amazon.de/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.de%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_de&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.de/",
		notebookUrl: "https://read.amazon.de/notebook",
		logoutUrl: "https://www.amazon.de/gp/flex/sign-out.html",
	},
	fr: {
		loginUrl:
			"https://www.amazon.fr/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.fr%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_fr&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.fr/",
		notebookUrl: "https://read.amazon.fr/notebook",
		logoutUrl: "https://www.amazon.fr/gp/flex/sign-out.html",
	},
	es: {
		loginUrl:
			"https://www.amazon.es/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.es%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_es&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.es/",
		notebookUrl: "https://read.amazon.es/notebook",
		logoutUrl: "https://www.amazon.es/gp/flex/sign-out.html",
	},
	it: {
		loginUrl:
			"https://www.amazon.it/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.it%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_it&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.it/",
		notebookUrl: "https://read.amazon.it/notebook",
		logoutUrl: "https://www.amazon.it/gp/flex/sign-out.html",
	},
	ca: {
		loginUrl:
			"https://www.amazon.ca/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.ca%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_ca&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.ca/",
		notebookUrl: "https://read.amazon.ca/notebook",
		logoutUrl: "https://www.amazon.ca/gp/flex/sign-out.html",
	},
	"com.au": {
		loginUrl:
			"https://www.amazon.com.au/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.com.au%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_au&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.com.au/",
		notebookUrl: "https://read.amazon.com.au/notebook",
		logoutUrl: "https://www.amazon.com.au/gp/flex/sign-out.html",
	},
	"com.br": {
		loginUrl:
			"https://www.amazon.com.br/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.com.br%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_br&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.com.br/",
		notebookUrl: "https://read.amazon.com.br/notebook",
		logoutUrl: "https://www.amazon.com.br/gp/flex/sign-out.html",
	},
	"com.mx": {
		loginUrl:
			"https://www.amazon.com.mx/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.com.mx%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_mx&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.com.mx/",
		notebookUrl: "https://read.amazon.com.mx/notebook",
		logoutUrl: "https://www.amazon.com.mx/gp/flex/sign-out.html",
	},
	in: {
		loginUrl:
			"https://www.amazon.in/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fread.amazon.in%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=amzn_kp_mobile_in&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&",
		cloudReaderUrl: "https://read.amazon.in/",
		notebookUrl: "https://read.amazon.in/notebook",
		logoutUrl: "https://www.amazon.in/gp/flex/sign-out.html",
	},
};

export function getRegionUrls(region: string): AmazonRegionUrls | undefined {
	return REGION_URLS[region];
}

// Helper function to parse author string (from example)
export const parseAuthor = (scrapedAuthor: string): string => {
	// Example format: "著者: Author Name" or "By: Author Name"
	// Removes prefix like "著者: " or "By: "
	return (
		scrapedAuthor?.replace(/^(著者:|By:)\s*/i, "")?.trim() ||
		"Unknown Author"
	);
};

// Helper function to parse date string (adapted from example with region handling)
export const parseToDateString = (
	kindleDate: string | undefined,
	region: string
): Date | null => {
	if (!kindleDate) return null;

	let date: moment.Moment;

	switch (region) {
		case "co.jp": {
			// Example: "2025年3月29日 土曜日"
			// Extract the date part before the day name
			const datePart = kindleDate.substring(0, kindleDate.indexOf(" "));
			// Use Japanese format (Year, Month, Day with Kanji)
			date = moment(datePart, "YYYY年M月D日", "ja", true); // Use 'ja' locale and strict parsing
			break;
		}
		// TODO: Add cases for other regions with specific formats (e.g., 'fr') if needed
		default: {
			// Default to English formats (handle full and abbreviated months)
			// Example: "October 24, 2021" or "Mar 29, 2025"
			date = moment(kindleDate, ["MMMM D, YYYY", "MMM DD, YYYY"], true); // Strict parsing
			break;
		}
	}

	return date.isValid() ? date.toDate() : null;
};

// --- Constants --- (Keep outside class)
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36"; // Re-add

// --- CSS Selectors --- (Keep outside class)
const BOOK_SELECTOR = ".kp-notebook-library-each-book"; // Main container for each book
// const BOOK_ASIN_ATTR = "data-asin"; // Removed - ASIN extraction is more complex now
const BOOK_TITLE_SELECTOR = "h2.kp-notebook-searchable"; // Updated based on example
const BOOK_AUTHOR_SELECTOR = "p.kp-notebook-searchable"; // Updated based on example
// const BOOK_COVER_SELECTOR = "img.kp-notebook-cover-image";
const HIGHLIGHT_CONTAINER_SELECTOR =
	".a-row.a-spacing-base.kp-notebook-highlight"; // Assuming this is still correct
const HIGHLIGHT_TEXT_SELECTOR = "#highlight";
const HIGHLIGHT_NOTE_SELECTOR = "#note";
const HIGHLIGHT_LOCATION_SELECTOR = "#annotationHighlightHeader";
const HIGHLIGHT_ASIN_ATTR = "data-asin";

import type { BrowserWindow } from "electron"; // Import BrowserWindow type

export class KindleApiService {
	private loggedIn = false; // Type inferred from literal
	private app: App; // Store App instance
	private loginWindow: BrowserWindow | null = null; // Store reference to the login window

	constructor(app: App) {
		this.app = app;
	}

	public isLoggedIn(): boolean {
		return this.loggedIn;
	}

	/**
	 * Initiates the login process using the AmazonLoginModal.
	 * @param region The Amazon region code (e.g., 'com', 'co.jp').
	 * @returns True if login was successful, false otherwise.
	 */
	// Return type remains boolean for external callers, but internally handles the window
	public async login(region: string): Promise<boolean> {
		console.log("KindleApiService: Initiating login...");
		// Clean up any previous login window first
		this.cleanupLoginWindow();

		const loginModal = new AmazonLoginModal(region);
		// Destructure the result from doLogin
		const { success, window } = await loginModal.doLogin();

		if (success && window) {
			this.loggedIn = true;
			this.loginWindow = window; // Store the window reference
			console.log("KindleApiService: Login successful, window stored.");
		} else {
			this.loggedIn = false;
			this.loginWindow = null; // Ensure window reference is cleared on failure
			console.log("KindleApiService: Login cancelled or failed.");
			// Ensure the window is cleaned up if login failed but window was somehow returned
			if (window && !window.isDestroyed()) {
				window.destroy();
			}
		}
		return success; // Return only the success status
	}

	// Helper method to clean up the login window
	private cleanupLoginWindow(): void {
		if (this.loginWindow && !this.loginWindow.isDestroyed()) {
			try {
				this.loginWindow.destroy();
				console.log(
					"KindleApiService: Previous login window destroyed."
				);
			} catch (e) {
				console.error(
					"KindleApiService: Error destroying previous login window:",
					e
				);
			}
		}
		this.loginWindow = null;
	}

	/**
	 * Logs the user out by resetting the internal state.
	 * TODO: Implement actual session clearing (e.g., cookie removal).
	 */
	public async logout(region: string): Promise<void> {
		// Added region parameter
		console.log("KindleApiService: Logging out...");
		this.loggedIn = false;

		// Attempt to clear session via hidden iframe (best effort)
		const regionUrls = getRegionUrls(region);
		if (regionUrls?.logoutUrl) {
			console.log(
				`Attempting logout via iframe navigation to: ${regionUrls.logoutUrl}`
			);
			try {
				const iframe = document.createElement("iframe");
				iframe.style.display = "none"; // Keep it hidden
				iframe.src = regionUrls.logoutUrl;
				document.body.appendChild(iframe);

				// Wait a short period for the navigation to potentially clear cookies
				await new Promise((resolve) => setTimeout(resolve, 1500)); // Wait 1.5 seconds

				// Clean up the iframe
				document.body.removeChild(iframe);
				console.log(
					"Logout iframe navigation attempted and iframe removed."
				);
			} catch (error) {
				console.error("Error during iframe logout attempt:", error);
				// Ignore errors here, as it's a best-effort attempt
			}
		} else {
			console.warn(
				`Logout URL not found for region: ${region}. Skipping iframe logout attempt.`
			);
		}

		new Notice(
			"Logged out from Kindle session (internal state cleared). Session clearing via Amazon is best-effort."
		);
	}

	/**
	 * Fetches books and highlights from the Kindle Cloud Reader notebook page.
	 * Requires the user to be logged in.
	 * @param region The Amazon region code.
	 * @returns An object containing arrays of books and highlights.
	 */
	public async fetchHighlights(
		region: string
	): Promise<{ books: Book[]; highlights: Highlight[] }> {
		if (!this.loggedIn) {
			const errorMsg = "Not logged in to Amazon Kindle.";
			console.error(`KindleApiService: ${errorMsg}`);
			new Notice(errorMsg);
			throw new Error(errorMsg);
		}

		console.log("KindleApiService: Fetching highlights...");
		const regionUrls = getRegionUrls(region);
		if (!regionUrls) {
			const errorMsg = `Invalid or unsupported Amazon region: ${region}`;
			console.error(`KindleApiService: ${errorMsg}`);
			new Notice(errorMsg);
			throw new Error(errorMsg);
		}
		const notebookUrl = regionUrls.notebookUrl;
		console.log(
			`KindleApiService: Scraping Kindle notebook: ${notebookUrl}`
		);

		try {
			// Check if we have a valid login window stored
			if (!this.loginWindow || this.loginWindow.isDestroyed()) {
				throw new Error(
					"Kindle session window is not available. Please log in again."
				);
			}

			// Use loadRemoteDom, passing the existing window and user agent
			const {
				dom: $,
				finalUrl,
				// html, // Remove unused html variable
			} = await loadRemoteDom(
				notebookUrl,
				USER_AGENT, // Pass user agent
				5000, // Keep increased timeout
				this.loginWindow
			);
			console.log(
				`KindleApiService: Successfully loaded/reused DOM from ${finalUrl}`
			);
			// Optional: Log HTML only if needed for deep debugging
			// console.log("--- Kindle Notebook HTML Start ---");
			// console.log(html);
			// console.log("--- Kindle Notebook HTML End ---");

			// --- Restore Parsing Logic ---
			const books: Book[] = [];
			const highlights: Highlight[] = [];

			// Parse Books
			$(BOOK_SELECTOR).each(
				(_index: number, element: cheerio.Element) => {
					const bookElement = $(element);
					// Get ASIN from the element's ID attribute
					const asin = bookElement.attr("id"); // Use 'asin' variable name
					// Use updated selectors
					const title = bookElement
						.find(BOOK_TITLE_SELECTOR)
						.text()
						?.trim();
					// Use updated selector and parseAuthor helper
					const scrapedAuthor = bookElement
						.find(BOOK_AUTHOR_SELECTOR)
						.text();
					const author = parseAuthor(scrapedAuthor);
					// Extract imageUrl
					const imageUrl = bookElement
						.find(".kp-notebook-cover-image")
						.attr("src");
					// Extract and parse lastAnnotatedDate
					const scrapedLastAnnotatedDate = bookElement
						.find('[id^="kp-notebook-annotated-date"]')
						.val() as string | undefined;
					const lastAnnotatedDate = parseToDateString(
						scrapedLastAnnotatedDate,
						region // Pass region argument
					);
					// Construct URL (assuming .com for now, needs region later)
					// TODO: Use region-specific domain from settings or regionUrls
					const url = `https://www.amazon.com/dp/${asin}`;

					if (asin && title) {
						// Add all extracted fields to the book object
						books.push({
							id: asin,
							title,
							author,
							asin,
							url,
							imageUrl,
							lastAnnotatedDate,
						});
					} else {
						console.warn(
							"Skipping book element due to missing ASIN or Title:", // Update warning message
							`ASIN: ${asin}, Title: ${title}`, // Log extracted values
							bookElement.html() // Log full element HTML for context
						);
					}
				}
			);
			console.log(`KindleApiService: Parsed ${books.length} books.`);

			// Parse Highlights
			$(HIGHLIGHT_CONTAINER_SELECTOR).each(
				(_index: number, element: cheerio.Element) => {
					// Add types
					const highlightElement = $(element);
					const bookId = highlightElement.attr(HIGHLIGHT_ASIN_ATTR);
					const text = highlightElement
						.find(HIGHLIGHT_TEXT_SELECTOR)
						.text()
						?.trim();
					const note =
						highlightElement
							.find(HIGHLIGHT_NOTE_SELECTOR)
							.text()
							?.trim() || undefined;
					const locationHeader = highlightElement
						.find(HIGHLIGHT_LOCATION_SELECTOR)
						.text()
						?.trim();
					const location = locationHeader || "Unknown Location";
					let page: number | undefined;
					const pageMatch = location.match(/page (\d+)/i);
					if (pageMatch) {
						page = parseInt(pageMatch[1], 10);
					}
					const id = `highlight-${bookId}-${_index}`; // Simple ID generation

					if (bookId && text) {
						highlights.push({
							id,
							bookId,
							text,
							location,
							page,
							note,
						});
					} else {
						console.warn(
							"Skipping highlight element due to missing Book ID or Text:",
							highlightElement.html()
						);
					}
				}
			);
			console.log(
				`KindleApiService: Parsed ${highlights.length} highlights.`
			);

			// Check if nothing was parsed despite successful load
			if (books.length === 0 && highlights.length === 0) {
				console.warn(
					"No books or highlights found after parsing the notebook page. Structure might have changed?"
				);
				new Notice(
					"Could not find any books or highlights on the Kindle Notebook page. The page structure might have changed, or there might be no highlights."
				);
			}

			return { books, highlights };
		} catch (error) {
			console.error(
				"KindleApiService: Error fetching highlights:", // Restore original error context
				error
			);
			// Don't automatically log out on fetch errors, could be temporary
			new Notice(`Error fetching Kindle highlights: ${error.message}`);
			throw error;
		}
	}
}

// Remove the old exported scrapeKindleHighlights function if it exists at the end
