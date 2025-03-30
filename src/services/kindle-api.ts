import moment from "moment"; // Revert to default import
import { App, Notice } from "obsidian"; // Keep App, Notice
import { AmazonLoginModal } from "../modals/AmazonLoginModal"; // Import the modal
import { Book, Highlight } from "../models";
import { loadRemoteDom } from "../utils/remote-loader"; // Add loadRemoteDom
// import { br2ln, hash } from "../utils"; // Assume these exist - TODO: Add these functions

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
const BOOK_IMAGE_SELECTOR = ".kp-notebook-cover-image"; // Added for clarity
const BOOK_LAST_ANNOTATED_SELECTOR = '[id^="kp-notebook-annotated-date"]'; // Added for clarity
// const BOOK_COVER_SELECTOR = "img.kp-notebook-cover-image";

// --- Highlight Selectors (from reference code) ---
const HIGHLIGHT_CONTAINER_SELECTOR = ".a-row.a-spacing-base"; // Reference uses this as the base row
const HIGHLIGHT_TEXT_SELECTOR = "#highlight"; // Reference uses ID
const HIGHLIGHT_NOTE_SELECTOR = "#note"; // Reference uses ID
const HIGHLIGHT_LOCATION_SELECTOR = "#kp-annotation-location"; // Reference uses this ID for location value
const HIGHLIGHT_PAGE_HEADER_SELECTOR = "#annotationNoteHeader"; // Reference uses this for page number text
const HIGHLIGHT_COLOR_SELECTOR = ".kp-notebook-highlight"; // Reference uses this class on a child element for color
const PAGINATION_TOKEN_SELECTOR = ".kp-notebook-annotations-next-page-start"; // Reference selector
const PAGINATION_LIMIT_STATE_SELECTOR = ".kp-notebook-content-limit-state"; // Reference selector
// const HIGHLIGHT_ASIN_ATTR = "data-asin"; // ASIN seems to be part of the URL now, not attribute

// --- Color Mapping (from reference code) ---
const mapTextToColor = (
	highlightClasses: string | undefined
): Highlight["color"] => {
	if (!highlightClasses) return undefined;
	const matches = /kp-notebook-highlight-(.*)/.exec(highlightClasses);
	// Ensure the return type matches Highlight['color'] which is string | undefined
	return matches ? (matches[1] as Highlight["color"]) : undefined;
};

// --- Pagination State ---
type NextPageState = {
	token: string;
	contentLimitState: string;
};

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

	// --- Private Helper Methods for Highlight Scraping (Adapted from reference) ---

	private _buildHighlightsUrl(
		regionUrls: AmazonRegionUrls,
		book: Book,
		state?: NextPageState
	): string {
		// Use notebookUrl from the provided regionUrls
		return `${regionUrls.notebookUrl}?asin=${book.asin}&contentLimitState=${
			state?.contentLimitState ?? ""
		}&token=${state?.token ?? ""}`;
	}

	private _parseNextPageState($: cheerio.Root): NextPageState | null {
		const contentLimitState = $(
			PAGINATION_LIMIT_STATE_SELECTOR
		).val() as string; // Added type assertion
		const token = $(PAGINATION_TOKEN_SELECTOR).val() as string; // Added type assertion
		// Ensure both values are present, not just token
		return token && contentLimitState ? { contentLimitState, token } : null;
	}

	private _parseHighlightsOnPage(
		$: cheerio.Root,
		bookAsin: string // Pass book ASIN for association
	): Highlight[] {
		const highlightsEl = $(HIGHLIGHT_CONTAINER_SELECTOR).toArray();

		return highlightsEl
			.map((highlightEl): Highlight | null => {
				// Use $ within the context of the current element
				const element = $(highlightEl);

				// Find elements relative to the container
				const textElement = element.find(HIGHLIGHT_TEXT_SELECTOR);
				const noteElement = element.find(HIGHLIGHT_NOTE_SELECTOR);
				const locationElement = element.find(
					HIGHLIGHT_LOCATION_SELECTOR
				);
				const pageHeaderElement = element.find(
					HIGHLIGHT_PAGE_HEADER_SELECTOR
				);
				const colorElement = element.find(HIGHLIGHT_COLOR_SELECTOR); // Find the element with color class

				const text = textElement.text()?.trim();
				if (!text) {
					// Skip if no highlight text found
					console.warn(
						"Skipping highlight element due to missing Text:",
						element.html()
					);
					return null;
				}

				const location =
					(locationElement.val() as string) || "Unknown Location"; // Get value from input
				const pageHeader = pageHeaderElement.text()?.trim();
				const pageMatch = pageHeader?.match(/page (\d+)/i); // Match against header text
				const page = pageMatch ? parseInt(pageMatch[1], 10) : undefined;

				const highlightClasses = colorElement.attr("class"); // Get classes from the specific color element
				const color = mapTextToColor(highlightClasses); // Use correct function name

				// TODO: Implement or import br2ln function
				const noteHtml = noteElement.html();
				const note = noteHtml ? noteHtml.trim() : undefined; // Use html() for potential <br>, trim later if needed
				// const note = noteHtml ? br2ln(noteHtml).trim() : undefined; // Use br2ln when available

				// TODO: Implement or import hash function
				// Generate ID based on ASIN, location, and text snippet. Hash is preferred when available.
				const id = `highlight-${bookAsin}-${location}-${text.substring(
					0,
					10
				)}`;
				// const id = hash(text); // Use hash when available

				return {
					id,
					bookId: bookAsin, // Use passed ASIN (HIGHLIGHT_ASIN_ATTR was removed)
					text,
					color,
					location,
					page,
					note,
				};
			})
			.filter((h): h is Highlight => h !== null); // Filter out null values
	}

	private async _loadAndScrapeHighlightsPage(
		book: Book,
		url: string,
		regionUrls: AmazonRegionUrls // Pass regionUrls
	): Promise<{
		highlights: Highlight[];
		nextPageUrl: string | null; // Can be null if no next page
		hasNextPage: boolean;
	}> {
		// Check for valid login window before loading
		if (!this.loginWindow || this.loginWindow.isDestroyed()) {
			throw new Error(
				"Kindle session window is not available for loading highlights page. Please log in again."
			);
		}

		const { dom: $ } = await loadRemoteDom(
			url,
			USER_AGENT,
			5000, // Keep timeout
			this.loginWindow // Reuse existing window
		);

		const highlights = this._parseHighlightsOnPage($, book.asin); // Pass ASIN
		const nextPageState = this._parseNextPageState($);
		const hasNextPage = nextPageState !== null;
		const nextPageUrl = hasNextPage
			? this._buildHighlightsUrl(regionUrls, book, nextPageState) // Pass regionUrls
			: null;

		return {
			highlights,
			nextPageUrl,
			hasNextPage,
		};
	}

	private async _scrapePaginatedHighlightsForBook(
		book: Book,
		regionUrls: AmazonRegionUrls // Pass regionUrls
	): Promise<Highlight[]> {
		let allHighlights: Highlight[] = [];
		let hasNextPage = true;
		// Start with the base notebook URL for the book
		let nextPageUrl: string | null = this._buildHighlightsUrl(
			regionUrls,
			book
		); // Pass regionUrls

		console.log(
			`KindleApiService: Scraping highlights for book: ${book.title} (ASIN: ${book.asin})`
		);

		while (hasNextPage && nextPageUrl) {
			try {
				console.log(` - Loading highlights page: ${nextPageUrl}`);
				// Explicitly type 'data' based on the return type of the awaited function
				const data: {
					highlights: Highlight[];
					nextPageUrl: string | null;
					hasNextPage: boolean;
				} = await this._loadAndScrapeHighlightsPage(
					book,
					nextPageUrl,
					regionUrls // Pass regionUrls
				);

				console.log(
					`   - Parsed ${data.highlights.length} highlights from page.`
				);
				allHighlights = [...allHighlights, ...data.highlights];

				hasNextPage = data.hasNextPage;
				nextPageUrl = data.nextPageUrl;

				// Small delay to avoid overwhelming the server? Optional.
				// await new Promise(resolve => setTimeout(resolve, 200));
			} catch (pageError) {
				console.error(
					`KindleApiService: Error scraping page ${nextPageUrl} for book ${book.asin}:`,
					pageError
				);
				// Decide if we should stop for this book or try to continue? Stop for now.
				hasNextPage = false;
				// Optionally re-throw or handle differently
				throw new Error(
					`Failed to scrape highlights page for book ${book.title}: ${pageError.message}`
				);
			}
		}

		console.log(
			`KindleApiService: Finished scraping for book ${book.asin}. Total highlights: ${allHighlights.length}`
		);
		return allHighlights;
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

			// --- Parsing Logic ---
			let books: Book[] = []; // Changed const to let
			let allHighlights: Highlight[] = []; // Use 'let' and rename

			// Parse Books (Keep existing book parsing logic)
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
						.find(BOOK_IMAGE_SELECTOR) // Use constant
						.attr("src");
					// Extract and parse lastAnnotatedDate
					const scrapedLastAnnotatedDate = bookElement
						.find(BOOK_LAST_ANNOTATED_SELECTOR) // Use constant
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

			// --- TEMPORARY: Limit books for testing ---
			if (books.length > 10) {
				console.log(
					`KindleApiService: Limiting books to 10 for testing (original count: ${books.length}).`
				);
				books = books.slice(0, 10);
			}
			// --- End Temporary ---

			// --- Fetch Highlights for Each Book (New Logic) ---
			if (books.length > 0) {
				console.log(
					"KindleApiService: Starting highlight fetching for parsed books..."
				);
				for (const book of books) {
					try {
						const bookHighlights =
							await this._scrapePaginatedHighlightsForBook(
								book,
								regionUrls
							); // Pass regionUrls
						allHighlights = [...allHighlights, ...bookHighlights];
					} catch (bookHighlightError) {
						console.error(
							`KindleApiService: Failed to fetch highlights for book ${book.title} (ASIN: ${book.asin}). Skipping book. Error:`,
							bookHighlightError
						);
						// Optionally notify the user about skipping a book
						new Notice(
							`Could not fetch highlights for book: ${book.title}. See console for details.`
						);
					}
				}
				console.log(
					`KindleApiService: Finished fetching highlights for all books. Total highlights: ${allHighlights.length}`
				);
			} else {
				console.log(
					"KindleApiService: No books found on the initial page, skipping highlight fetching."
				);
			}

			// Check if nothing was parsed despite successful load
			if (books.length === 0 && allHighlights.length === 0) {
				// Check allHighlights now
				console.warn(
					"No books or highlights found after parsing the notebook page. Structure might have changed?"
				);
				new Notice(
					"Could not find any books or highlights on the Kindle Notebook page. The page structure might have changed, or there might be no highlights."
				);
			}

			return { books, highlights: allHighlights }; // Return aggregated highlights
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
