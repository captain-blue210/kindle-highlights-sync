// Removed import type - rely on @types/electron and require
import { Notice } from "obsidian";
import { getRegionUrls } from "../services/kindle-api"; // Import helper

// Attempt to import Electron remote module - this might vary depending on Obsidian/Electron version
// eslint-disable-next-line @typescript-eslint/no-var-requires
const electron = require("electron");
const remote = electron?.remote || electron?.contextBridge?.electron?.remote; // Handle potential variations
const BrowserWindow = remote?.BrowserWindow; // Use original name

export class AmazonLoginModal {
	private loginPromise: Promise<boolean>; // Resolves true on success, false on cancel/failure
	private resolvePromise!: (success: boolean) => void; // Definite assignment assertion
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
				"AmazonLoginModal: Electron BrowserWindow is not available. Cannot create login window.",
				this.resolvePromise(false)
			);
		}
	}

	/**
	 * Opens a new browser window for Amazon login and returns a promise
	 * that resolves with true upon successful login, or false if cancelled/failed.
	 */
	public async doLogin(): Promise<boolean> {
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
			this.resolvePromise(false); // Resolve immediately if prerequisites fail
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
					this.resolvePromise(true);
					this.closeWindow(); // Close the window safely
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
				this.loginPromise.then((alreadyResolved) => {
					if (!alreadyResolved) {
						this.resolvePromise(false);
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

	// Helper to safely close the window
	private closeWindow() {
		if (this.modal && !this.modal.isDestroyed()) {
			try {
				this.modal.close();
			} catch (e) {
				console.error("AmazonLoginModal: Error closing window:", e);
			}
		}
		this.modal = null;
	}

	// No longer need onOpen or onClose as we're not using Obsidian's Modal
}
