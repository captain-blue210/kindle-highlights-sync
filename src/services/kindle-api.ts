import * as cheerio from "cheerio";
import { App, Notice, requestUrl } from "obsidian"; // Added App
import { AmazonLoginModal } from "../modals/AmazonLoginModal"; // Import the modal
import { Book, Highlight } from "../models";

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

// --- Constants --- (Keep outside class)
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36";

// --- CSS Selectors --- (Keep outside class)
const BOOK_SELECTOR = ".kp-notebook-library-each-book";
const BOOK_ASIN_ATTR = "data-asin";
const BOOK_TITLE_SELECTOR = ".kp-notebook-library-book-title";
const BOOK_AUTHOR_SELECTOR = ".kp-notebook-library-book-author";
// const BOOK_COVER_SELECTOR = "img.kp-notebook-cover-image"; // Commented out - not currently used
const HIGHLIGHT_CONTAINER_SELECTOR =
	".a-row.a-spacing-base.kp-notebook-highlight";
const HIGHLIGHT_TEXT_SELECTOR = "#highlight";
const HIGHLIGHT_NOTE_SELECTOR = "#note";
const HIGHLIGHT_LOCATION_SELECTOR = "#annotationHighlightHeader";
const HIGHLIGHT_ASIN_ATTR = "data-asin";

export class KindleApiService {
	private loggedIn = false; // Type inferred from literal
	private app: App; // Store App instance

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
	public async login(region: string): Promise<boolean> {
		console.log("KindleApiService: Initiating login...");
		const loginModal = new AmazonLoginModal(region); // Removed this.app argument
		const success = await loginModal.doLogin();
		if (success) {
			this.loggedIn = true;
			console.log("KindleApiService: Login successful.");
		} else {
			this.loggedIn = false; // Ensure state is false on cancel/failure
			console.log("KindleApiService: Login cancelled or failed.");
		}
		return success;
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
			const response = await requestUrl({
				url: notebookUrl,
				method: "GET",
				headers: {
					"User-Agent": USER_AGENT,
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
					"Accept-Language": "en-US,en;q=0.9",
					// Cookies are expected to be handled implicitly by requestUrl/Electron session
				},
				throw: false,
			});

			console.log(
				`KindleApiService: Scraping response status: ${response.status}`
			);

			// Check for potential redirect to login page (indicating invalid session)
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers["location"];
				if (location && location.includes("/ap/signin")) {
					this.loggedIn = false; // Update state as session is invalid
					throw new Error(
						"Authentication failed or session expired. Please log in again."
					);
				}
			}

			if (response.status !== 200) {
				// Could be a temporary error, don't necessarily invalidate login state yet
				throw new Error(
					`Failed to fetch Kindle Notebook page. Status: ${response.status}`
				);
			}

			const html = response.text;
			const $ = cheerio.load(html);

			const books: Book[] = [];
			const highlights: Highlight[] = [];

			// --- Parse Books --- (Logic remains the same as before)
			$(BOOK_SELECTOR).each((_index, element) => {
				const bookElement = $(element);
				const id = bookElement.attr(BOOK_ASIN_ATTR);
				const title = bookElement
					.find(BOOK_TITLE_SELECTOR)
					.text()
					?.trim();
				const author =
					bookElement
						.find(BOOK_AUTHOR_SELECTOR)
						.text()
						?.trim()
						.replace(/^By\s+/i, "") || "Unknown Author";
				// const coverUrl = bookElement // Commented out to fix unused variable warning
				// 	.find(BOOK_COVER_SELECTOR)
				// 	.attr("src"); // Keep parsing, even if unused for now

				if (id && title) {
					books.push({ id, title, author /* coverUrl */ });
				} else {
					console.warn(
						"Skipping book element due to missing ID or Title:",
						bookElement.html()
					);
				}
			});
			console.log(`KindleApiService: Parsed ${books.length} books.`);

			// --- Parse Highlights --- (Logic remains the same as before)
			$(HIGHLIGHT_CONTAINER_SELECTOR).each((_index, element) => {
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
				const id = `highlight-${bookId}-${_index}`;

				if (bookId && text) {
					highlights.push({ id, bookId, text, location, page, note });
				} else {
					console.warn(
						"Skipping highlight element due to missing Book ID or Text:",
						highlightElement.html()
					);
				}
			});
			console.log(
				`KindleApiService: Parsed ${highlights.length} highlights.`
			);

			if (
				books.length === 0 &&
				highlights.length === 0 &&
				response.text.length > 0
			) {
				// Check response text length to avoid false positives on empty responses
				console.warn(
					"No books or highlights found on the notebook page. Structure might have changed?"
				);
				new Notice(
					"Could not find any books or highlights on the Kindle Notebook page. The page structure might have changed, or there might be no highlights."
				);
			}

			return { books, highlights };
		} catch (error) {
			console.error(
				"KindleApiService: Error fetching highlights:",
				error
			);
			// Don't automatically log out on fetch errors, could be temporary
			new Notice(`Error fetching Kindle highlights: ${error.message}`);
			throw error;
		}
	}
}

// Remove the old exported scrapeKindleHighlights function if it exists at the end
