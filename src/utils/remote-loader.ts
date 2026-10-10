import * as cheerio from "cheerio";
import type { BrowserWindow } from "electron";

export type RemoteDomResult = {
	dom: cheerio.CheerioAPI;
	finalUrl: string;
	html: string;
};

/** Read the notebook in the isolated, authenticated window supplied by the session controller. */
export async function loadRemoteDom(
	targetUrl: string,
	_userAgent: string,
	delay = 0,
	window?: BrowserWindow | null,
): Promise<RemoteDomResult> {
	if (!window || window.isDestroyed())
		throw new Error("Kindle session window unavailable");
	const wc = window.webContents;
	return new Promise((resolve, reject) => {
		let settled = false,
			reading = false,
			delayTimer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			clearTimeout(timeout);
			if (delayTimer) clearTimeout(delayTimer);
			wc.removeListener("did-finish-load", finished);
			wc.removeListener("did-fail-load", failed);
			window.removeListener?.("closed", closed);
		};
		const fail = (message: string) => {
			if (settled) return;
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
					const html = await wc.executeJavaScript(
						"document.body.innerHTML",
						true,
					);
					if (settled) return;
					const dom = cheerio.load(
						html,
					) as unknown as cheerio.CheerioAPI;
					const finalUrl = wc.getURL();
					settled = true;
					cleanup();
					resolve({ html, dom, finalUrl });
				} catch {
					fail("Notebook content unavailable");
				}
			};
			if (delay > 0) delayTimer = setTimeout(read, delay);
			else void read();
		};
		const timeout = setTimeout(
			() => fail("Notebook navigation timed out"),
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
