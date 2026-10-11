import { EventEmitter } from "events";
import { runInNewContext } from "vm";
import * as cheerio from "cheerio";

/** An HTML-backed Electron boundary: execute the actual reader against each snapshot. */
export function notebookWindow(htmlForUrl: (url: string) => string) {
	let url = "";
	const window = Object.assign(new EventEmitter(), {
		isDestroyed: () => false,
		loadURL: async (next: string) => {
			url = next;
			queueMicrotask(() => window.webContents.emit("did-finish-load"));
		},
		webContents: Object.assign(new EventEmitter(), {
			getURL: () => url,
			reload: () =>
				queueMicrotask(() =>
					window.webContents.emit("did-finish-load"),
				),
			executeJavaScript: async (script: string) => {
				const html = htmlForUrl(url),
					$ = cheerio.load(html);
				const element = (el: cheerio.Element) => ({
					value: $(el).attr("value"),
					classList: {
						contains: (name: string) => $(el).hasClass(name),
					},
					display:
						/display\s*:\s*none/.test($(el).attr("style") ?? "") ||
						$(el).hasClass("aok-hidden")
							? "none"
							: "block",
				});
				return runInNewContext(script, {
					document: {
						body: { innerHTML: html },
						querySelector: (selector: string) =>
							$(selector).length
								? element($(selector).get(0))
								: null,
						querySelectorAll: (selector: string) =>
							$(selector).toArray().map(element),
					},
					getComputedStyle: (el: { display: string }) => el,
				});
			},
		}),
	});
	return window;
}

export function libraryHtml(asins: string[], complete: boolean) {
	return `<div id="kp-notebook-library">${asins.map((asin) => `<div class="kp-notebook-library-each-book" id="${asin}"><h2 class="kp-notebook-searchable">Book ${asin}</h2></div>`).join("")}</div>
		<input class="kp-notebook-library-next-page-start" value="old-page-token">
		<input class="kp-notebook-library-next-page-start" value="${complete ? "" : "next-page-token"}">
		<div id="kp-notebook-library-spinner" ${complete ? 'style="display: none;"' : ""}></div>
		<div id="kp-notebook-library-load-error" class="aok-hidden"></div>`;
}
