import { EventEmitter } from "events"; // ★ Import EventEmitter
import { parseAmazonDate } from "./amazon-date";
import { App, Notice } from "obsidian"; // Keep App, Notice
import { createAmazonSession, AmazonSessionController } from "./amazon-session";
import { Book, Highlight } from "../models";
import { loadRemoteDom } from "../utils/remote-loader";
import { HighlightParser } from "./highlight-parser"; // Import the new parser
// import { br2ln, hash } from "../utils";

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
export const parseAuthor = (
	scrapedAuthor: string | undefined,
): string | undefined => {
	// Example format: "著者: Author Name" or "By: Author Name"
	// Removes prefix like "著者: " or "By: "
	const author = scrapedAuthor?.replace(/^(著者:|By:)\s*/i, "")?.trim();
	// Return the trimmed author name only if it's not empty, otherwise return undefined
	return author ? author : undefined;
};

// Helper function to parse date string (adapted from example with region handling)
export const parseToDateString = parseAmazonDate;

// --- Constants --- (Keep outside class)
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36"; // Re-add

// --- CSS Selectors for Pagination ---
const PAGINATION_TOKEN_SELECTOR = ".kp-notebook-annotations-next-page-start";
const PAGINATION_LIMIT_STATE_SELECTOR = ".kp-notebook-content-limit-state";
// Book and Highlight selectors are now in HighlightParser

// --- Pagination State ---
type NextPageState = {
	token: string;
	contentLimitState: string;
};

import type { BrowserWindow } from "electron"; // Import BrowserWindow type

export class KindleApiService {
	private loggedIn = false;
	private loginWindow: BrowserWindow | null = null;
	private sessionController: AmazonSessionController | undefined;
	private parser = new HighlightParser();
	constructor(
		private app: App,
		private secretRefs: Record<string, string> = {},
		private saveRefs: () => Promise<void> = async () => {},
	) {}
	private sessions() {
		return (this.sessionController ??= createAmazonSession(
			this.app,
			getRegionUrls,
			this.secretRefs,
			this.saveRefs,
		));
	}
	public isLoggedIn(): boolean {
		return this.loggedIn;
	}
	public async login(region: string): Promise<boolean> {
		this.loggedIn = false;
		this.loginWindow = null;
		this.loginWindow = await this.sessions().ensureAuthenticated(region);
		return (this.loggedIn = this.loginWindow !== null);
	}
	public async persist(region: string): Promise<void> {
		await this.sessions().persist(region);
	}
	public dispose(): void {
		this.loggedIn = false;
		this.loginWindow = null;
		this.sessionController?.dispose();
	}

	// --- Private Helper Methods for Highlight Scraping ---

	private _buildHighlightsUrl(
		regionUrls: AmazonRegionUrls,
		book: Book,
		state?: NextPageState,
	): string {
		// Use notebookUrl from the provided regionUrls
		return `${regionUrls.notebookUrl}?asin=${book.asin}&contentLimitState=${encodeURIComponent(
			state?.contentLimitState ?? "",
		)}&token=${encodeURIComponent(state?.token ?? "")}`;
	}

	// Updated _parseNextPageState to use CheerioAPI type
	private _parseNextPageState($: cheerio.CheerioAPI): NextPageState | null {
		const contentLimitState = $(
			PAGINATION_LIMIT_STATE_SELECTOR,
		).val() as string;
		const token = $(PAGINATION_TOKEN_SELECTOR).val() as string;
		return token
			? { contentLimitState: contentLimitState ?? "", token }
			: null;
	}

	// _parseHighlightsOnPage and _loadAndScrapeHighlightsPage removed.

	// Updated _scrapePaginatedHighlightsForBook to use HighlightParser and emit progress
	private async _scrapePaginatedHighlightsForBook(
		book: Book,
		regionUrls: AmazonRegionUrls,
		emitter: EventEmitter, // ★ Add emitter
	): Promise<Highlight[]> {
		emitter.emit("fetch:highlights:start", { bookTitle: book.title }); // ★ Emit highlight fetch start for book
		const allHighlights: Highlight[] = []; // Use const
		let hasNextPage = true;
		let nextPageUrl: string | null = this._buildHighlightsUrl(
			regionUrls,
			book,
		);
		const visitedUrls = new Set<string>();
		let totalHighlightsForBook = 0; // Keep track of total highlights for this book

		console.log(
			`KindleApiService: Scraping highlights for book: ${book.title} (ASIN: ${book.asin})`,
		);

		while (hasNextPage && nextPageUrl) {
			try {
				emitter.emit("fetch:page:start", {
					bookTitle: book.title,
					url: regionUrls.notebookUrl,
				}); // ★ Emit page start

				if (visitedUrls.has(nextPageUrl))
					throw new Error("Repeated pagination token");
				visitedUrls.add(nextPageUrl);
				// Check for valid login window before loading
				if (!this.loginWindow || this.loginWindow.isDestroyed()) {
					throw new Error(
						"Kindle session window is not available for loading highlights page. Please log in again.",
					);
				}

				// Load the current page's DOM
				const { dom: $, finalUrl } = await loadRemoteDom(
					nextPageUrl,
					USER_AGENT,
					5000, // Keep timeout
					this.loginWindow, // Reuse existing window
				);

				const pageUrl = new URL(finalUrl);
				if (
					pageUrl.protocol !== "https:" ||
					pageUrl.hostname !==
						new URL(regionUrls.notebookUrl).hostname ||
					pageUrl.pathname !== "/notebook" ||
					pageUrl.searchParams.get("asin") !== book.asin ||
					!(
						$("#kp-notebook-annotations").length ||
						// Amazon returns annotation fragments, including empty final pages.
						($("input.kp-notebook-content-limit-state").length &&
							$("input.kp-notebook-annotations-next-page-start")
								.length)
					) ||
					$(
						'form[name="signIn"], form[action*="signin"], #ap_signin_form, #ap_password, #auth-captcha-image, #captchacharacters, #auth-mfa-otpcode',
					).length
				)
					throw new Error(
						"Amazon session expired or highlight page unavailable",
					);
				// Parse highlights using the existing page parser
				const highlightsOnPage = this.parser.parseHighlightsPage(
					$,
					book.asin,
				);
				console.log(
					`   - Parsed ${highlightsOnPage.length} highlights from page.`,
				);
				allHighlights.push(...highlightsOnPage);
				totalHighlightsForBook += highlightsOnPage.length;

				// Emit progress for each highlight found on the page
				highlightsOnPage.forEach((highlight, index) => {
					emitter.emit("fetch:highlights:progress", {
						bookTitle: book.title,
						highlightText: highlight.text,
						highlightsParsedOnPage: index + 1, // Count for this specific page
						totalHighlightsForBook: totalHighlightsForBook, // Running total for the book
					});
					// Optional delay could go here if needed per highlight
				});

				emitter.emit("fetch:page:end", {
					// ★ Emit page end
					bookTitle: book.title,
					url: regionUrls.notebookUrl,
					highlightsFound: highlightsOnPage.length,
				});

				// This block seems duplicated from the previous change, removing it.

				// Parse pagination state for the *next* page
				const nextPageState = this._parseNextPageState($);
				hasNextPage = nextPageState !== null;
				nextPageUrl = hasNextPage
					? this._buildHighlightsUrl(
							regionUrls,
							book,
							nextPageState ?? undefined,
						) // Pass undefined if null - Corrected indentation
					: null;

				// Small delay to avoid overwhelming the server? Optional.
				// await new Promise(resolve => setTimeout(resolve, 200));
			} catch (pageError) {
				console.error(
					`KindleApiService: Highlight page unavailable for book ${book.asin}`,
				);
				emitter.emit("fetch:page:error", {
					bookTitle: book.title,
					url: regionUrls.notebookUrl,
					error: "Highlight page unavailable",
				}); // ★ Emit page error
				// Decide if we should stop for this book or try to continue? Stop for now.
				hasNextPage = false;
				// Optionally re-throw or handle differently
				throw new Error(
					`Failed to scrape highlights for book ${book.title}`,
				);
			}
		}

		console.log(
			`KindleApiService: Finished scraping for book ${book.asin}. Total highlights: ${allHighlights.length}`,
		);
		emitter.emit("fetch:highlights:end", {
			bookTitle: book.title,
			highlightCount: totalHighlightsForBook,
		}); // Emit highlight fetch end for book
		return allHighlights;
	}

	public async logout(region: string): Promise<void> {
		this.loggedIn = false;
		this.loginWindow = null;
		await this.sessions().logout(region);
	}

	/**
	 * Fetches books and highlights from the Kindle Cloud Reader notebook page.
	 * Requires the user to be logged in.
	 * @param region The Amazon region code.
	 * @returns An object containing arrays of books and highlights.
	 */
	public async fetchHighlights(
		region: string,
		emitter: EventEmitter, // Add emitter parameter
	): Promise<{
		books: Book[];
		highlights: Highlight[];
		failedBooks: number;
	}> {
		if (!this.loggedIn) {
			const errorMsg = "Not logged in to Amazon Kindle.";
			console.error(`KindleApiService: ${errorMsg}`);
			new Notice(errorMsg);
			throw new Error(errorMsg);
		}

		console.log("KindleApiService: Fetching books and highlights...");
		emitter.emit("fetch:start"); // Emit fetch start
		const regionUrls = getRegionUrls(region);
		if (!regionUrls) {
			const errorMsg = `Invalid or unsupported Amazon region: ${region}`;
			console.error(`KindleApiService: ${errorMsg}`);
			new Notice(errorMsg);
			throw new Error(errorMsg);
		}
		const notebookUrl = regionUrls.notebookUrl;
		console.log(
			`KindleApiService: Scraping Kindle notebook: ${notebookUrl}`,
		);

		try {
			// 1. Load the main notebook page DOM
			console.log(
				`KindleApiService: Loading notebook page: ${regionUrls.notebookUrl}`,
			);
			if (!this.loginWindow || this.loginWindow.isDestroyed()) {
				throw new Error(
					"Kindle session window is not available. Please log in again.",
				);
			}
			const { dom: notebookDom, finalUrl } = await loadRemoteDom(
				regionUrls.notebookUrl,
				USER_AGENT,
				5000, // Keep timeout
				this.loginWindow, // Reuse existing window
			);
			console.log("KindleApiService: Notebook loaded");

			const notebookAddress = new URL(finalUrl);
			if (
				notebookAddress.protocol !== "https:" ||
				notebookAddress.hostname !==
					new URL(regionUrls.notebookUrl).hostname ||
				notebookAddress.pathname !== "/notebook" ||
				!notebookDom("#kp-notebook-library").length ||
				notebookDom(
					'form[action*="signin"], #ap_signin_form, #auth-captcha-image',
				).length
			)
				throw new Error(
					"Amazon session expired or notebook unavailable",
				);
			// 2. Parse Books using HighlightParser
			console.log(
				"KindleApiService: Parsing books using HighlightParser...",
			);
			emitter.emit("fetch:booklist:start"); // Indicate book list parsing start

			// Use the existing parser method which parses all books at once
			const books = this.parser.parseNotebookPage(notebookDom, region);

			// Emit progress after parsing all books
			// We can't easily emit per-book progress without changing the parser significantly
			emitter.emit("fetch:booklist:end", { totalBooks: books.length }); // Indicate book list parsing end

			console.log(`KindleApiService: Parsed ${books.length} books.`);
			if (books.length === 0) {
				console.warn(
					"KindleApiService: No books parsed from the notebook page.",
				);
				emitter.emit("fetch:end"); // Emit fetch end early
				return { books: [], highlights: [], failedBooks: 0 }; // Return early
			}

			const successfulBooks: Book[] = [];

			// 3. Scrape Highlights for each parsed book (Paginated)
			console.log(
				"KindleApiService: Starting paginated highlight scraping...",
			);
			const allHighlights: Highlight[] = []; // Define allHighlights here - Use const

			// Use the limited list for scraping
			for (const book of books) {
				try {
					// ★ Pass emitter down
					const bookHighlights =
						await this._scrapePaginatedHighlightsForBook(
							book,
							regionUrls,
							emitter, // ★ Pass emitter
						);
					allHighlights.push(...bookHighlights);
					successfulBooks.push(book);
				} catch (error) {
					console.error(
						`KindleApiService: Failed to scrape highlights for book ${book.title} (ASIN: ${book.asin}):`,
						error,
					);
					// Optionally emit a specific book error event
					emitter.emit("fetch:book:error", {
						bookTitle: book.title,
						error: error.message,
					});
					new Notice(
						`Failed to fetch highlights for "${book.title}". Check console for details.`,
					);
					// Continue to next book even if one fails
				}
			}

			console.log(
				`KindleApiService: Fetch complete. Total books processed: ${successfulBooks.length}, Total highlights: ${allHighlights.length}`,
			);
			emitter.emit("fetch:end"); // Emit fetch end

			// Return the original full book list but only highlights for the processed (limited) books
			return {
				books: successfulBooks,
				highlights: allHighlights,
				failedBooks: books.length - successfulBooks.length,
			}; // Return original 'books' list
		} catch (error) {
			console.error(
				"KindleApiService: Error fetching highlights:",
				error,
			);
			emitter.emit("fetch:error", error.message || "Unknown fetch error"); // Emit fetch error
			// Don't automatically log out on fetch errors, could be temporary
			// new Notice(`Error fetching Kindle highlights: ${error.message}`); // Let main handler or modal show notice
			throw error;
		}
	}
}

// Ensure no old exported functions remain at the end
