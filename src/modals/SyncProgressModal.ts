import { EventEmitter } from "events";
import { App, Modal, setIcon } from "obsidian"; // Import setIcon

// Define payload types for better type safety (optional but recommended)
// Note: These interfaces are not strictly necessary if not using strong typing on payloads,
// but help with clarity and maintenance. ESLint might warn if they are unused.
interface FetchBooklistEndPayload {
	totalBooks: number;
}
interface FetchPageStartPayload {
	bookTitle: string;
	url: string;
}
interface FetchHighlightsStartPayload {
	bookTitle: string;
}
interface FetchHighlightsProgressPayload {
	bookTitle: string;
	highlightText: string;
	highlightsParsedOnPage: number;
	totalHighlightsForBook: number;
}
interface FetchHighlightsEndPayload {
	bookTitle: string;
	highlightCount: number;
}
interface FetchBookErrorPayload {
	bookTitle: string;
	error: string;
}
interface FetchPageErrorPayload {
	bookTitle: string;
	url: string;
	error: string;
}
interface StartPayload {
	totalBookCount: number;
}
interface BookStartPayload {
	bookTitle: string;
	booksProcessedCount: number;
	totalBookCount: number;
}
interface ProgressPayload {
	bookTitle: string;
	booksProcessedCount: number;
	totalBookCount: number;
	highlightsProcessedCountForBook: number;
	currentHighlightText: string;
}
interface BookEndPayload {
	bookTitle: string;
	booksProcessedCount: number;
	totalBookCount: number;
}

export class SyncProgressModal extends Modal {
	private emitter: EventEmitter;
	private statusContainerEl: HTMLElement; // Container for text status
	private spinnerEl: HTMLElement | null = null; // Spinner element
	private messageEl: HTMLElement; // General message area
	private currentBookEl: HTMLElement;
	private bookProgressEl: HTMLElement; // Used for both fetch and processing book counts
	private currentHighlightEl: HTMLElement;
	private highlightProgressEl: HTMLElement; // Used for both fetch and processing highlight counts
	private isCompleted = false;
	private hasError = false;

	constructor(app: App, emitter: EventEmitter) {
		super(app);
		this.emitter = emitter;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty(); // Clear previous content if any
		this.titleEl.setText("Kindle同期"); // Initial title

		// Container for status text elements
		this.statusContainerEl = contentEl.createDiv({
			cls: "kindle-sync-status-container",
		});

		// General message area (initially shown)
		this.messageEl = this.statusContainerEl.createEl("p", {
			text: "初期化中...",
		});

		// Placeholder elements for detailed status (initially hidden)
		this.currentBookEl = this.statusContainerEl.createEl("p", {
			cls: "kindle-sync-current-book u-display-none",
		});
		this.bookProgressEl = this.statusContainerEl.createEl("p", {
			cls: "kindle-sync-book-progress u-display-none",
		});
		this.currentHighlightEl = this.statusContainerEl.createEl("p", {
			cls: "kindle-sync-current-highlight u-display-none",
		});
		this.highlightProgressEl = this.statusContainerEl.createEl("p", {
			cls: "kindle-sync-highlight-progress u-display-none",
		});

		// Apply CSS for highlight truncation
		this.applyStyles();

		// Register event listeners
		this.registerEvents();
	}

	onClose() {
		const { contentEl } = this;
		// Unregister all listeners attached to this emitter instance for this modal
		this.emitter.removeAllListeners();
		contentEl.empty();
	}

	private applyStyles() {
		// Add CSS rule for highlight truncation and layout dynamically
		const styleEl = document.createElement("style");
		styleEl.textContent = `
	           .kindle-sync-status-container {
	               display: flex;
	               flex-direction: column;
	               align-items: center; /* Center items horizontally */
	               text-align: center; /* Center text */
	               min-height: 100px; /* Ensure some minimum height */
	               justify-content: center; /* Center items vertically */
	               padding-top: 10px; /* Add some padding */
	               padding-bottom: 10px;
	           }
	           .kindle-sync-spinner {
	               margin-bottom: 15px; /* Space below spinner */
	           }
	           .kindle-sync-current-highlight {
	               white-space: nowrap;
	               overflow: hidden;
	               text-overflow: ellipsis;
	               max-width: 90%; /* Limit width */
	               margin-top: 5px;
	               margin-bottom: 5px;
	               color: var(--text-muted); /* Muted color for less emphasis */
	               font-size: var(--font-ui-small); /* Smaller font */
	           }
	           .u-display-none {
	               display: none !important; /* Utility class to hide elements */
	           }
	           .modal-success-icon svg, .modal-error-icon svg { /* Target the SVG inside */
	                margin-bottom: 15px;
	                width: 48px; /* Set icon size */
	                height: 48px; /* Set icon size */
	           }
	           .modal-success-icon {
	                color: var(--interactive-accent); /* Use accent for success */
	           }
	           .modal-error-icon {
	                color: var(--text-error); /* Use error color */
	           }
	           .modal-error-container { /* Center error message */
	               display: flex;
	               flex-direction: column;
	               align-items: center;
	               text-align: center;
	           }
	       `;
		this.contentEl.appendChild(styleEl);
	}

	// Helper to add/remove spinner
	private showSpinner() {
		if (!this.spinnerEl) {
			// Use Obsidian's loading icon component if available, otherwise a simple div
			this.spinnerEl = this.contentEl.createDiv({
				cls: "loading-spinner kindle-sync-spinner",
			});
			// Prepend spinner before the status text container
			this.contentEl.prepend(this.spinnerEl);
		}
	}

	private hideSpinner() {
		if (this.spinnerEl) {
			this.spinnerEl.remove();
			this.spinnerEl = null;
		}
	}

	// Helper to update status text and manage visibility
	private updateStatus(
		elementsToShow: HTMLElement[],
		textUpdates: { el: HTMLElement; text: string }[]
	) {
		// Hide all detailed status elements first
		this.messageEl.addClass("u-display-none"); // Hide general message too
		this.currentBookEl.addClass("u-display-none");
		this.bookProgressEl.addClass("u-display-none");
		this.currentHighlightEl.addClass("u-display-none");
		this.highlightProgressEl.addClass("u-display-none");

		// Update text for specified elements
		textUpdates.forEach((update) => {
			// Ensure the element exists before setting text
			if (update.el) {
				update.el.setText(update.text);
			} else {
				console.warn(
					"Attempted to update text on a non-existent element."
				);
			}
		});

		// Show specified elements
		elementsToShow.forEach((el) => {
			if (el) {
				el.removeClass("u-display-none");
			}
		});
	}

	private registerEvents() {
		// --- Fetching Events ---
		this.emitter.on("fetch:start", this.handleFetchStart.bind(this));
		this.emitter.on(
			"fetch:booklist:start",
			this.handleFetchBooklistStart.bind(this)
		);
		// this.emitter.on('fetch:booklist:progress', this.handleFetchBooklistProgress.bind(this)); // Might be too noisy
		this.emitter.on(
			"fetch:booklist:end",
			this.handleFetchBooklistEnd.bind(this)
		);
		this.emitter.on(
			"fetch:page:start",
			this.handleFetchPageStart.bind(this)
		);
		this.emitter.on(
			"fetch:highlights:start",
			this.handleFetchHighlightsStart.bind(this)
		);
		this.emitter.on(
			"fetch:highlights:progress",
			this.handleFetchHighlightsProgress.bind(this)
		);
		this.emitter.on(
			"fetch:highlights:end",
			this.handleFetchHighlightsEnd.bind(this)
		);
		this.emitter.on("fetch:page:end", this.handleFetchPageEnd.bind(this));
		this.emitter.on("fetch:end", this.handleFetchEnd.bind(this));
		this.emitter.on("fetch:error", this.handleFetchError.bind(this));
		this.emitter.on(
			"fetch:book:error",
			this.handleFetchBookError.bind(this)
		); // Specific book fetch error
		this.emitter.on(
			"fetch:page:error",
			this.handleFetchPageError.bind(this)
		); // Specific page fetch error

		// --- Processing Events (after fetching) ---
		this.emitter.on("start", this.handleProcessingStart.bind(this)); // Renamed from handleStart
		this.emitter.on(
			"book:start",
			this.handleProcessingBookStart.bind(this)
		); // Renamed from handleBookStart
		this.emitter.on("progress", this.handleProcessingProgress.bind(this)); // Renamed from handleProgress
		this.emitter.on("book:end", this.handleProcessingBookEnd.bind(this)); // Renamed from handleBookEnd
		this.emitter.on("end", this.handleProcessingEnd.bind(this)); // Renamed from handleEnd
		this.emitter.on("error", this.handleProcessingError.bind(this)); // Renamed from handleError
	}

	// --- Fetching Event Handlers ---

	private handleFetchStart() {
		console.log("Fetch started");
		this.titleEl.setText("Kindleからデータを取得中");
		this.showSpinner();
		this.updateStatus(
			[this.messageEl],
			[{ el: this.messageEl, text: "Amazonに接続中..." }]
		);
	}

	private handleFetchBooklistStart() {
		console.log("Fetching book list...");
		this.updateStatus(
			[this.messageEl],
			[{ el: this.messageEl, text: "書籍リストを取得中..." }]
		);
	}

	private handleFetchBooklistEnd(payload: FetchBooklistEndPayload) {
		console.log(`Book list fetched: ${payload.totalBooks} books`);
		this.updateStatus(
			[this.messageEl],
			[
				{
					el: this.messageEl,
					text: `${payload.totalBooks}冊の書籍情報を取得しました。ハイライトを取得します...`,
				},
			]
		);
	}

	private handleFetchPageStart(payload: FetchPageStartPayload) {
		console.log(`Fetching page for book: ${payload.bookTitle}`);
		// Update status to show which book's highlights are being fetched
		this.updateStatus(
			[this.currentBookEl, this.messageEl], // Show book title and general message
			[
				{ el: this.currentBookEl, text: `書籍: ${payload.bookTitle}` },
				{ el: this.messageEl, text: `ハイライト読込中...` },
			]
		);
	}

	private handleFetchHighlightsStart(payload: FetchHighlightsStartPayload) {
		console.log(`Fetching highlights for: ${payload.bookTitle}`);
		// Update status, maybe clear previous highlight text
		this.updateStatus(
			[this.currentBookEl, this.messageEl],
			[
				{ el: this.currentBookEl, text: `書籍: ${payload.bookTitle}` },
				{ el: this.messageEl, text: `ハイライトを解析中...` },
			]
		);
	}

	private handleFetchHighlightsProgress(
		payload: FetchHighlightsProgressPayload
	) {
		// console.log(`Highlight progress: ${payload.highlightText}`); // Can be very noisy
		// Update the current highlight text and progress count
		this.updateStatus(
			[
				this.currentBookEl,
				this.currentHighlightEl,
				this.highlightProgressEl,
			], // Show book, current highlight, and count
			[
				{ el: this.currentBookEl, text: `書籍: ${payload.bookTitle}` },
				{
					el: this.currentHighlightEl,
					text: `ハイライト: ${payload.highlightText}`,
				},
				{
					el: this.highlightProgressEl,
					text: `取得済みハイライト (この書籍): ${payload.totalHighlightsForBook}`,
				},
			]
		);
		if (this.currentHighlightEl) {
			// Check if element exists before setting attribute
			this.currentHighlightEl.setAttribute(
				"title",
				payload.highlightText
			); // Tooltip for full text
		}
	}

	private handleFetchHighlightsEnd(payload: FetchHighlightsEndPayload) {
		console.log(
			`Finished fetching highlights for: ${payload.bookTitle} (${payload.highlightCount} highlights)`
		);
		// Clear the specific highlight text, keep book title and total count
		this.updateStatus(
			[this.currentBookEl, this.highlightProgressEl], // Show book title and final count for the book
			[
				{ el: this.currentBookEl, text: `書籍: ${payload.bookTitle}` },
				{
					el: this.highlightProgressEl,
					text: `ハイライト取得完了 (${payload.highlightCount}件)`,
				},
			]
		);
	}

	private handleFetchPageEnd(/* payload: FetchPageEndPayload */) {
		// console.log(`Finished fetching page for ${payload.bookTitle}, found ${payload.highlightsFound} highlights.`);
		// No specific UI update needed here usually, handled by highlight progress/end
	}

	private handleFetchEnd() {
		console.log("Fetch finished");
		this.titleEl.setText("データ取得完了");
		this.hideSpinner(); // Hide spinner after fetching
		this.updateStatus(
			[this.messageEl],
			[
				{
					el: this.messageEl,
					text: "データの取得が完了しました。ノートを生成します...",
				},
			]
		);
		// Note: Processing events will take over from here
	}

	private handleFetchError(errorMessage: string) {
		console.error("Fetch error:", errorMessage);
		this.handleError(`データ取得エラー: ${errorMessage}`); // Use generic error handler
	}

	private handleFetchBookError(payload: FetchBookErrorPayload) {
		console.error(
			`Error fetching highlights for book ${payload.bookTitle}:`,
			payload.error
		);
		// Log the error, but let the main 'fetch:error' or 'error' handler manage the modal UI state.
		// Avoid showing multiple notices or conflicting modal states.
	}

	private handleFetchPageError(payload: FetchPageErrorPayload) {
		console.error(
			`Error fetching page ${payload.url} for book ${payload.bookTitle}:`,
			payload.error
		);
		// Log the error, let the main error handler manage the UI.
	}

	// --- Processing Event Handlers (Renamed) ---

	private handleProcessingStart(payload: StartPayload) {
		console.log("Processing started:", payload.totalBookCount);
		this.titleEl.setText("ノートを生成中");
		this.showSpinner(); // Show spinner again for processing phase
		this.updateStatus(
			[this.bookProgressEl], // Show only book progress initially
			[
				{
					el: this.bookProgressEl,
					text: `ノート生成中: 0 / ${payload.totalBookCount}`,
				},
			]
		);
	}

	private handleProcessingBookStart(payload: BookStartPayload) {
		console.log("Processing book start:", payload.bookTitle);
		if (this.isCompleted || this.hasError) return;
		this.updateStatus(
			[this.currentBookEl, this.bookProgressEl, this.messageEl], // Show book, progress, and general message
			[
				{ el: this.currentBookEl, text: `書籍: ${payload.bookTitle}` },
				{
					el: this.bookProgressEl,
					text: `ノート生成中: ${payload.booksProcessedCount} / ${payload.totalBookCount}`,
				},
				{ el: this.messageEl, text: `ハイライト処理中...` },
			]
		);
	}

	private handleProcessingProgress(payload: ProgressPayload) {
		// console.log('Processing progress:', payload.currentHighlightText); // Can be noisy
		if (this.isCompleted || this.hasError) return;
		// Update highlight text and count for the *note generation* phase
		this.updateStatus(
			[
				this.currentBookEl,
				this.bookProgressEl,
				this.currentHighlightEl,
				this.highlightProgressEl,
			], // Show all details
			[
				{ el: this.currentBookEl, text: `書籍: ${payload.bookTitle}` },
				{
					el: this.bookProgressEl,
					text: `ノート生成中: ${payload.booksProcessedCount} / ${payload.totalBookCount}`,
				},
				{
					el: this.currentHighlightEl,
					text: `処理中ハイライト: ${payload.currentHighlightText}`,
				},
				{
					el: this.highlightProgressEl,
					text: `処理済みハイライト (この書籍): ${payload.highlightsProcessedCountForBook}`,
				},
			]
		);
		if (this.currentHighlightEl) {
			this.currentHighlightEl.setAttribute(
				"title",
				payload.currentHighlightText
			);
		}
	}

	private handleProcessingBookEnd(payload: BookEndPayload) {
		console.log("Processing book end:", payload.bookTitle);
		if (this.isCompleted || this.hasError) return;
		// Update book count, clear highlight text
		this.updateStatus(
			[this.currentBookEl, this.bookProgressEl], // Show book title (completed) and overall progress
			[
				{
					el: this.currentBookEl,
					text: `書籍: ${payload.bookTitle} - 完了`,
				},
				{
					el: this.bookProgressEl,
					text: `ノート生成中: ${payload.booksProcessedCount} / ${payload.totalBookCount}`,
				},
			]
		);
	}

	private handleProcessingEnd() {
		console.log("Processing finished");
		if (this.hasError) return; // Don't overwrite error message
		this.isCompleted = true;
		this.hideSpinner();
		this.titleEl.setText("同期完了");
		// Show final completion message
		this.statusContainerEl.empty(); // Clear previous status elements
		const iconContainer = this.statusContainerEl.createDiv({
			// Renamed variable for clarity
			cls: "modal-success-icon",
		});
		setIcon(iconContainer, "check-circle"); // Correct: 2 arguments
		this.statusContainerEl.createEl("p", {
			text: "Kindleハイライトの同期が正常に完了しました。",
		});

		setTimeout(() => this.close(), 2000); // Close after 2 seconds
	}

	// Generic Error Handler (Renamed from handleError)
	private handleProcessingError(errorMessage: string) {
		this.handleError(`ノート処理エラー: ${errorMessage}`);
	}

	// Centralized Error Display
	private handleError(errorMessage: string) {
		console.error("Sync error:", errorMessage);
		if (this.isCompleted) return; // Don't overwrite completion message
		this.hasError = true;
		this.hideSpinner();
		this.titleEl.setText("同期エラー");
		this.contentEl.empty(); // Clear everything

		const errorContainer = this.contentEl.createDiv({
			cls: "modal-error-container",
		});
		const iconContainer = errorContainer.createDiv({
			cls: "modal-error-icon",
		}); // Renamed variable
		setIcon(iconContainer, "alert-circle"); // Correct: 2 arguments
		errorContainer.createEl("p", { text: "エラーが発生しました:" });
		errorContainer.createEl("p", { text: errorMessage });

		const closeButton = this.contentEl.createEl("button", {
			text: "閉じる",
		});
		closeButton.style.marginTop = "15px";
		closeButton.onclick = () => this.close();
	}
}
