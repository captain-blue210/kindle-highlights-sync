import * as cheerio from "cheerio";
// Import Electron types using 'import type'
import type {
	DidFailLoadEvent,
	DidNavigateEvent,
	BrowserWindow as ElectronBrowserWindow,
} from "electron";

// Attempt to get remote module and BrowserWindow constructor via window.require
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any; // Declare window to access require if available
let RemoteBrowserWindow: typeof ElectronBrowserWindow | undefined;
try {
	const electron = window.require?.("electron");
	RemoteBrowserWindow = electron?.remote?.BrowserWindow;
} catch (e) {
	console.error("remote-loader: Failed to require electron remote:", e);
}

/**
 * Represents the result of loading a remote DOM.
 */
export type RemoteDomResult = {
	/** The Cheerio API object representing the loaded DOM. */
	dom: cheerio.CheerioAPI;
	/** The URL the window actually navigated to (useful for redirects). */
	finalUrl: string;
	/** The raw HTML content of the body. */
	html: string;
};

/**
 * Loads a remote URL in a hidden Electron BrowserWindow, extracts the body's
 * innerHTML after loading, parses it with Cheerio, and returns the result.
 * Can optionally use an existing BrowserWindow instance.
 *
 * @param targetUrl The URL to load.
 * @param userAgent The User-Agent string to use when creating a new window.
 * @param timeout Optional timeout in milliseconds to wait after 'did-finish-load'. Defaults to 0.
 * @param existingWindow Optional existing BrowserWindow instance to reuse.
 * @returns A Promise resolving to a RemoteDomResult object.
 */
export const loadRemoteDom = async (
	// Renamed back to loadRemoteDom
	targetUrl: string,
	userAgent: string, // Keep userAgent parameter
	timeout = 0,
	existingWindow?: ElectronBrowserWindow | null
): Promise<RemoteDomResult> => {
	// Update return type

	let windowToUse: ElectronBrowserWindow | null = null; // Initialize as null
	let createdNewWindow = false;

	// Decide whether to use existing window or create a new one
	if (existingWindow && !existingWindow.isDestroyed()) {
		console.log("loadRemoteDom: Reusing existing window.");
		windowToUse = existingWindow;
		createdNewWindow = false;
	} else {
		if (!RemoteBrowserWindow) {
			throw new Error(
				"loadRemoteDom: Electron BrowserWindow constructor is not available via remote."
			);
		}
		console.log("loadRemoteDom: Creating new hidden window.");
		try {
			windowToUse = new RemoteBrowserWindow({
				width: 1000,
				height: 800,
				webPreferences: {
					nodeIntegration: false,
					contextIsolation: true, // Keep true if types allow, otherwise comment out
					// partition: 'persist:kindle_session' // Optional
				},
				show: false,
			});
			createdNewWindow = true;
			// Set User Agent after creation
			windowToUse.webContents.setUserAgent(userAgent);
		} catch (e) {
			throw new Error(
				`loadRemoteDom: Failed to create new BrowserWindow: ${e.message}`
			);
		}
	}

	// Ensure we have a window instance to proceed
	if (!windowToUse) {
		throw new Error(
			"loadRemoteDom: Could not obtain a valid BrowserWindow instance."
		);
	}

	// Set a reasonable timeout for the entire operation
	const operationTimeout = 60000; // 60 seconds
	let timeoutHandle: NodeJS.Timeout | null = null;

	return new Promise<RemoteDomResult>((resolve, reject) => {
		// Update Promise return type
		let finalUrl: string = targetUrl; // Initialize with target URL
		let eventListenersAttached = false; // Flag to manage listeners

		// --- Cleanup function ---
		const cleanup = (shouldDestroy = true) => {
			// Add flag to control destruction
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}
			// Remove listeners if they were attached
			if (
				eventListenersAttached &&
				windowToUse &&
				!windowToUse.isDestroyed()
			) {
				windowToUse.webContents.removeAllListeners("did-fail-load");
				windowToUse.webContents.removeAllListeners("did-navigate");
				windowToUse.webContents.removeAllListeners("did-finish-load");
			}
			// Only destroy if we created it OR if explicitly told to
			if (
				createdNewWindow &&
				shouldDestroy &&
				windowToUse &&
				!windowToUse.isDestroyed()
			) {
				try {
					windowToUse.destroy();
					console.log("loadRemoteDom: Destroyed created window.");
				} catch (e) {
					console.error(
						"loadRemoteDom: Error destroying window in cleanup:",
						e
					);
				}
			}
		};

		// --- Operation Timeout ---
		timeoutHandle = setTimeout(() => {
			cleanup(); // Attempt cleanup, destroy if created
			reject(
				new Error(
					`Operation timed out after ${
						operationTimeout / 1000
					} seconds for URL: ${targetUrl}`
				)
			);
		}, operationTimeout);

		// --- Event Listeners ---
		if (windowToUse && !windowToUse.isDestroyed()) {
			const webContents = windowToUse.webContents;
			eventListenersAttached = true;

			// Handle potential loading errors
			webContents.on(
				"did-fail-load",
				(
					event: DidFailLoadEvent,
					errorCode: number,
					errorDescription: string,
					validatedURL: string
				) => {
					if (errorCode === -3) {
						// ERR_ABORTED
						console.log(
							`loadRemoteDom: Load aborted (errorCode ${errorCode}), likely due to navigation.`
						);
						return;
					}
					cleanup();
					reject(
						new Error(
							`Failed to load URL ${validatedURL}: ${errorDescription} (Code: ${errorCode})`
						)
					);
				}
			);

			// Track the final URL after any redirects
			webContents.on(
				"did-navigate",
				(event: DidNavigateEvent, url: string) => {
					finalUrl = url;
				}
			);

			// Main logic: execute script after page finishes loading
			webContents.on("did-finish-load", async () => {
				if (!windowToUse || windowToUse.isDestroyed()) {
					console.log(
						"loadRemoteDom: Window destroyed before did-finish-load could complete."
					);
					return;
				}
				try {
					// Optional delay
					if (timeout > 0) {
						await new Promise((resolveDelay) =>
							setTimeout(resolveDelay, timeout)
						);
					}

					if (!windowToUse || windowToUse.isDestroyed()) {
						console.log(
							"loadRemoteDom: Window destroyed during timeout delay."
						);
						return;
					}

					// Execute script to get innerHTML
					const html = await webContents.executeJavaScript(
						`document.body.innerHTML`,
						true // userGesture
					);

					// Parse HTML
					const dom = cheerio.load(html);

					// Success: clean up (don't destroy if reused) and resolve
					cleanup(false);
					// Resolve with dom, finalUrl, and html
					resolve({ dom: dom as cheerio.CheerioAPI, finalUrl, html });
				} catch (error: unknown) {
					cleanup();
					reject(
						new Error(
							`Error executing script or parsing HTML for ${finalUrl}: ${
								error instanceof Error
									? error.message
									: String(error)
							}`
						)
					);
				}
			});

			// --- Start Loading ---
			const currentURL = webContents.getURL();
			if (currentURL === targetUrl) {
				console.log(
					`loadRemoteDom: Already at target URL: ${targetUrl}. Reloading.`
				);
				// Reload if already at the target URL to ensure 'did-finish-load' fires
				webContents.reload();
			} else {
				console.log(`loadRemoteDom: Loading URL: ${targetUrl}`);
				windowToUse.loadURL(targetUrl);
			}
		} else {
			cleanup();
			reject(
				new Error(
					"loadRemoteDom: Invalid BrowserWindow instance provided or could not be created."
				)
			);
		}
	});
};
