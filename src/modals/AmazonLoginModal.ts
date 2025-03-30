// Removed import type - rely on @types/electron and require
import { Notice } from "obsidian";
import { getRegionUrls } from "../services/kindle-api"; // Import helper

// Attempt to import Electron remote module using window.require
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any; // Declare window to access require if available
let remote: any | undefined; // Use any for remote type
let BrowserWindow: typeof Electron.BrowserWindow | undefined;
try {
	const electron = window.require?.("electron");
	remote = electron?.remote;
	BrowserWindow = remote?.BrowserWindow;
} catch (e) {
	console.error("AmazonLoginModal: Failed to require electron remote:", e);
	// Keep remote and BrowserWindow as undefined
}

export class AmazonLoginModal {
	private loginPromise: Promise<{
		success: boolean;
		window?: Electron.BrowserWindow;
	}>; // Return window on success
	// Update resolvePromise type to match the promise
	private resolvePromise!: (result: {
		success: boolean;
		window?: Electron.BrowserWindow;
	}) => void;
	private modal: Electron.BrowserWindow | null = null; // Use Electron namespace type
	private readonly loginUrl: string | null;
	private readonly cloudReaderUrl: string | null;
	private readonly notebookUrl: string | null; // Added notebookUrl for potential use

	constructor(private region: string) {
		// Removed App dependency as we are not extending Modal

		const regionUrls = getRegionUrls(this.region);
		if (!regionUrls) {
			// Log error, but let doLogin handle user notification
			console.error(
				`Error: Invalid Amazon region configured: ${this.region}`
			);
			this.loginUrl = null;
			this.cloudReaderUrl = null;
			this.notebookUrl = null;
		} else {
			this.loginUrl = regionUrls.loginUrl;
			this.cloudReaderUrl = regionUrls.cloudReaderUrl;
			this.notebookUrl = regionUrls.notebookUrl; // Store notebook URL
		}

		// Initialize the promise
		this.loginPromise = new Promise((resolve) => {
			this.resolvePromise = resolve;
		});

		// Check if BrowserWindow is available
		if (!BrowserWindow) {
			// Use the correct variable name
			console.error(
				"AmazonLoginModal: Electron BrowserWindow is not available. Cannot create login window."
			);
			// Pass the correct object structure
			this.resolvePromise({ success: false });
		}
	}

	/**
	 * Opens a new browser window for Amazon login and returns a promise
	 * that resolves with an object containing success status and the window instance
	 * upon successful login, or just success status if cancelled/failed.
	 */
	public async doLogin(): Promise<{
		success: boolean;
		window?: Electron.BrowserWindow;
	}> {
		// Ensure URLs are valid and BrowserWindow is available
		if (
			!this.loginUrl ||
			!this.cloudReaderUrl ||
			!this.notebookUrl ||
			!BrowserWindow
		) {
			new Notice(
				"Error: Cannot initiate login. Invalid Amazon region configuration or Electron components unavailable."
			);
			this.resolvePromise({ success: false }); // Resolve immediately if prerequisites fail
			return this.loginPromise; // Return the already resolved promise
		}

		// Create the BrowserWindow instance
		this.modal = new BrowserWindow({
			parent: remote?.getCurrentWindow(), // Optional: makes it a modal to the main Obsidian window
			width: 500, // Adjusted size
			height: 750,
			show: false, // Don't show until ready
			webPreferences: {
				nodeIntegration: false, // Important for security
				// contextIsolation: true, // Removed - Property does not exist on type 'WebPreferences' in installed types
				// partition: `persist:amazon-login-${this.region}` // Optional: Isolate session/cookies per region
			},
		});

		// --- Event Listeners ---

		// Show window when it's ready
		if (this.modal) {
			// Add null check before attaching listener
			this.modal.on("ready-to-show", () => {
				// Change once to on
				if (this.modal) {
					// Keep inner null check for safety within callback
					this.modal.setTitle(
						`Amazon (${this.region}) Login - Kindle Highlights Sync`
					);
					this.modal.show();
					console.log("AmazonLoginModal: Login window shown.");
				}
			});

			// Detect successful login navigation
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			this.modal.webContents.on("did-navigate", (_event, url: string) => {
				// Removed : Event type annotation
				// Added types for _event and url
				console.log("AmazonLoginModal: Navigated to URL:", url); // Log navigation
				// Check if navigated to the Cloud Reader URL (indicates success)
				if (
					this.cloudReaderUrl &&
					url.startsWith(this.cloudReaderUrl)
				) {
					console.log(
						"AmazonLoginModal: Success detected (Cloud Reader URL)."
					);
					new Notice("Amazon login successful!");
					// Resolve with success and the window instance (if not null)
					this.resolvePromise({
						success: true,
						window: this.modal ?? undefined,
					});
					// Don't close the window, just hide it
					this.hideWindow(); // We'll rename closeWindow next
				}
				// Optional: Could also check for notebookUrl if loginUrl redirects there first
				// else if (this.notebookUrl && url.startsWith(this.notebookUrl)) {
				//     console.log("AmazonLoginModal: Success detected (Notebook URL).");
				//     new Notice("Amazon login successful!");
				//     this.resolvePromise(true);
				//     this.closeWindow();
				// }
			});

			// Handle window being closed by the user or other means
			this.modal.on("closed", () => {
				console.log("AmazonLoginModal: Login window closed.");
				// Only resolve as false if the promise hasn't already been resolved (e.g., by successful navigation)
				// This prevents overwriting a successful login if 'closed' fires slightly after 'did-navigate' success
				// Check the success property of the resolved object
				this.loginPromise.then((result) => {
					if (!result.success) {
						// Check if already resolved with success=false or not resolved yet
						this.resolvePromise({ success: false });
					}
				});
				this.modal = null; // Clean up reference
			});
		} // <-- Add missing closing brace for the `if (this.modal)` block started on line 86

		// --- Load Login URL ---
		// Also add null check here before calling loadURL
		if (this.modal) {
			try {
				console.log(`AmazonLoginModal: Loading URL: ${this.loginUrl}`);
				// Load the specific login URL which should redirect to Cloud Reader on success
				await this.modal.loadURL(this.loginUrl);
			} catch (error) {
				console.error("AmazonLoginModal: Error loading URL:", error);
				// The example code swallowed errors here, assuming successful login interrupts loading.
				// However, a genuine error could occur. We might still rely on did-navigate or closed events.
				// If the window doesn't open or load, the 'closed' event should eventually resolve(false).
			}
		} // <-- Add missing closing brace for the `if (this.modal)` block started on line 142

		return this.loginPromise;
	}

	// Helper to safely hide the window instead of closing it
	private hideWindow() {
		if (this.modal && !this.modal.isDestroyed()) {
			try {
				// Hide instead of close
				this.modal.hide();
				console.log("AmazonLoginModal: Login window hidden.");
			} catch (e) {
				console.error("AmazonLoginModal: Error hiding window:", e);
			}
		}
		// Don't set this.modal to null here, as we need the reference later
	}

	// No longer need onOpen or onClose as we're not using Obsidian's Modal
}
