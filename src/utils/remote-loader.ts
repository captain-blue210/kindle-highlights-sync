import * as cheerio from "cheerio";
import type { BrowserWindow } from "electron";

export type RemoteDomResult = {
	dom: cheerio.CheerioAPI;
	finalUrl: string;
	html: string;
	library?: LibraryReadResult;
};

export type LibrarySnapshot = {
	elapsedMs: number;
	rows: number;
	libraryPresent: boolean;
	spinnerHidden: boolean;
	terminalTokenEmpty: boolean;
	errorVisible: boolean;
};
export type LibraryReadResult = {
	status: "complete" | "load-failed" | "unconfirmed";
	snapshots: LibrarySnapshot[];
};

// Amazon appends library pages itself and hides the spinner at the empty terminal token.
const READ_LIBRARY = `(() => {
	const spinner = document.querySelector('#kp-notebook-library-spinner');
	const tokens = document.querySelectorAll('input.kp-notebook-library-next-page-start');
	const error = document.querySelector('#kp-notebook-library-load-error');
	return {
		html: document.body.innerHTML,
		snapshot: {
			rows: document.querySelectorAll('.kp-notebook-library-each-book').length,
			libraryPresent: !!document.querySelector('#kp-notebook-library'),
			spinnerHidden: !!spinner && getComputedStyle(spinner).display === 'none',
			terminalTokenEmpty: tokens.length > 0 && tokens[tokens.length - 1].value === '',
			errorVisible: !!error && !error.classList.contains('aok-hidden') && getComputedStyle(error).display !== 'none'
		},
		authenticationRequired: !!document.querySelector('form[name="signIn"], form[action*="signin"], #ap_signin_form, #ap_password, #auth-captcha-image, #captchacharacters, #auth-mfa-otpcode')
	};
})()`;

/** Read the notebook in the isolated, authenticated window supplied by the session controller. */
export async function loadRemoteDom(
	targetUrl: string,
	_userAgent: string,
	delay = 0,
	window?: BrowserWindow | null,
	options: { waitForLibrary?: boolean } = {},
): Promise<RemoteDomResult> {
	if (!window || window.isDestroyed())
		throw new Error("Kindle session window unavailable");
	const wc = window.webContents;
	return new Promise((resolve, reject) => {
		let settled = false,
			reading = false,
			delayTimer: ReturnType<typeof setTimeout> | undefined;
		const started = Date.now(),
			snapshots: LibrarySnapshot[] = [];
		let lastHtml: string | undefined;
		let lastFinalUrl = targetUrl;
		const succeed = (
			html: string,
			status?: LibraryReadResult["status"],
			finalUrl?: string,
		) => {
			if (settled) return;
			const result: RemoteDomResult = {
				html,
				dom: cheerio.load(html) as unknown as cheerio.CheerioAPI,
				finalUrl: finalUrl ?? wc.getURL(),
				...(status ? { library: { status, snapshots } } : {}),
			};
			settled = true;
			cleanup();
			resolve(result);
		};
		const cleanup = () => {
			clearTimeout(timeout);
			if (delayTimer) clearTimeout(delayTimer);
			wc.removeListener("did-finish-load", finished);
			wc.removeListener("did-fail-load", failed);
			window.removeListener?.("closed", closed);
		};
		const fail = (message: string) => {
			if (settled) return;
			if (options.waitForLibrary && lastHtml !== undefined) {
				succeed(lastHtml, "load-failed", lastFinalUrl);
				return;
			}
			settled = true;
			cleanup();
			reject(new Error(message));
		};
		const closed = () => fail("Kindle session window closed");
		const failed = (
			_event: unknown,
			code: number,
			_description: string,
			_url: string,
			isMainFrame = true,
		) => {
			if (isMainFrame && code !== -3) fail("Notebook navigation failed");
		};
		const finished = () => {
			if (settled || reading) return;
			reading = true;
			const read = async () => {
				try {
					if (window.isDestroyed()) {
						closed();
						return;
					}
					const content = await wc.executeJavaScript(
						options.waitForLibrary
							? READ_LIBRARY
							: "document.body.innerHTML",
						true,
					);
					if (settled) return;
					if (!options.waitForLibrary) {
						succeed(content);
						return;
					}
					lastFinalUrl = wc.getURL();
					lastHtml = content.html;
					const snapshot: LibrarySnapshot = {
						...content.snapshot,
						elapsedMs: Date.now() - started,
					};
					const previous = snapshots[snapshots.length - 1];
					if (
						!previous ||
						Object.keys(content.snapshot).some(
							(key) =>
								previous[key as keyof LibrarySnapshot] !==
								content.snapshot[key],
						)
					)
						snapshots.push(snapshot);
					if (snapshot.errorVisible) {
						succeed(content.html, "load-failed");
						return;
					}
					if (
						content.authenticationRequired ||
						lastFinalUrl !== targetUrl
					) {
						succeed(content.html, "unconfirmed");
						return;
					}
					if (
						snapshot.libraryPresent &&
						snapshot.spinnerHidden &&
						snapshot.terminalTokenEmpty
					) {
						succeed(content.html, "complete");
						return;
					}
					delayTimer = setTimeout(read, 250);
				} catch {
					fail("Notebook content unavailable");
				}
			};
			if (delay > 0) delayTimer = setTimeout(read, delay);
			else void read();
		};
		const timeout = setTimeout(
			() =>
				options.waitForLibrary && lastHtml !== undefined
					? succeed(lastHtml, "unconfirmed", lastFinalUrl)
					: fail("Notebook navigation timed out"),
			60000,
		);
		wc.on("did-finish-load", finished);
		wc.on("did-fail-load", failed);
		window.on?.("closed", closed);
		try {
			if (wc.getURL() === targetUrl) wc.reload();
			else
				void window
					.loadURL(targetUrl)
					.catch(() => fail("Notebook navigation failed"));
		} catch {
			fail("Notebook navigation failed");
		}
	});
}
