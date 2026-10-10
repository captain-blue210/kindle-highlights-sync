import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import type { BrowserWindow } from "electron";
import {
	createAmazonSession,
	createAmazonSessionController,
	isAuthenticatedNotebook,
} from "./amazon-session";
import { sessionKey } from "./session-store";
const urls = (region: string) => ({
	loginUrl: `https://www.amazon.${region}/ap/signin`,
	cloudReaderUrl: `https://read.amazon.${region}/`,
	notebookUrl: `https://read.amazon.${region}/notebook`,
	logoutUrl: `https://www.amazon.${region}/gp/flex/sign-out.html`,
});
const cookie = {
	name: "session-id",
	value: "fake-only",
	domain: ".amazon.co.jp",
	path: "/",
	secure: true,
	httpOnly: true,
	sameSite: "lax",
	expirationDate: 2000,
};
const record = (cookies: unknown[] = [cookie]) =>
	JSON.stringify({ version: 1, region: "co.jp", cookies });
const library = '<div id="kp-notebook-library"></div>';
class FakeWindow extends EventEmitter {
	destroyed = false;
	visible = false;
	url = "";
	html = "";
	failure = false;
	shown!: () => void;
	shownPromise = new Promise<void>((resolve) => (this.shown = resolve));
	webContents = Object.assign(new EventEmitter(), {
		getURL: () => this.url,
		executeJavaScript: async () => this.html,
		setWindowOpenHandler: () => undefined,
	});
	constructor(
		readonly jar: { cookies: any[] },
		readonly route: (url: string) => { url: string; html: string } | Error,
	) {
		super();
	}
	async loadURL(url: string) {
		const page = this.route(url);
		if (page instanceof Error) throw page;
		this.url = page.url;
		this.html = page.html;
		this.webContents.emit("did-finish-load");
	}
	navigate(url: string, html: string) {
		this.url = url;
		this.html = html;
		this.webContents.emit("did-finish-load");
	}
	show() {
		this.visible = true;
		this.shown();
	}
	hide() {
		this.visible = false;
	}
	isDestroyed() {
		return this.destroyed;
	}
	destroy() {
		if (!this.destroyed) {
			this.destroyed = true;
			this.emit("closed");
		}
	}
}
function setup(
	payload?: string,
	vaultIdentity = "/vault/A",
	initializeWindow?: (w: FakeWindow) => void,
) {
	const secretIds: Record<string, string> = {};
	const secrets = new Map<string, string>();
	if (payload !== undefined) {
		secretIds["co.jp"] = sessionKey(vaultIdentity, "co.jp");
		secrets.set(secretIds["co.jp"], payload);
	}
	const jars = new Map<string, { cookies: any[]; cleared: number }>();
	const windows: FakeWindow[] = [];
	let savedRefs = 0;
	let writeSecret = (id: string, payload: string): void | Promise<void> => {
		secrets.set(id, payload);
	};
	let readSecret = (id: string): string | null | Promise<string | null> =>
		secrets.get(id) ?? null;
	let route = (url: string) => ({
		url,
		html: url.includes("/notebook")
			? library
			: '<form name="signIn"><input id="ap_password"></form>',
	});
	const controller = createAmazonSessionController({
		vaultIdentity,
		urlsForRegion: urls,
		secretIds,
		saveSecretRefs: async () => {
			savedRefs++;
		},
		now: () => 1500,
		secrets: {
			getSecret: (id: string) => readSecret(id),
			setSecret: (id: string, payload: string) =>
				writeSecret(id, payload),
		},
		sessionForPartition: (partition: string) => {
			let jar = jars.get(partition);
			if (!jar) {
				jar = { cookies: [], cleared: 0 };
				jars.set(partition, jar);
			}
			const current = jar;
			return {
				cookies: {
					get: async () => current.cookies,
					set: async (c: any) => {
						current.cookies.push({
							...c,
							domain: c.domain ?? new URL(c.url).hostname,
						});
					},
				},
				clearStorageData: async () => {
					current.cookies = [];
					current.cleared++;
				},
				clearCache: async () => undefined,
			};
		},
		createWindow: (partition: string) => {
			const w = new FakeWindow(jars.get(partition)!, (url) => route(url));
			initializeWindow?.(w);
			windows.push(w);
			return w as unknown as BrowserWindow;
		},
	});
	return {
		controller,
		secretIds,
		secrets,
		jars,
		windows,
		setRoute: (next: typeof route) => (route = next),
		setReadSecret: (next: typeof readSecret) => (readSecret = next),
		setWriteSecret: (next: typeof writeSecret) => (writeSecret = next),
		get savedRefs() {
			return savedRefs;
		},
	};
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
describe("Amazon session authentication", () => {
	it("restores isolated cookie attributes and validates even an empty library", async () => {
		const s = setup(record());
		const window = await s.controller.ensureAuthenticated("co.jp");
		expect(window).toBe(s.windows[0]);
		expect(s.windows[0].visible).toBe(false);
		const [[partition, jar]] = Array.from(s.jars);
		expect(partition.startsWith("persist:")).toBe(false);
		expect(jar.cookies[0]).toMatchObject({
			httpOnly: true,
			secure: true,
			path: "/",
			domain: ".amazon.co.jp",
			sameSite: "lax",
			expirationDate: 2000,
			url: "https://amazon.co.jp/",
		});
		expect(
			JSON.parse(s.secrets.get(s.secretIds["co.jp"])!).cookies[0].value,
		).toBe("fake-only");
	});
	it.each([
		undefined,
		"corrupt",
		record([{ ...cookie, expirationDate: 1000 }]),
	])(
		"opens manual login and settles cancellation for absent, corrupt or expired secret",
		async (payload) => {
			const s = setup(payload);
			const result = s.controller.ensureAuthenticated("co.jp");
			await tick();
			expect(s.windows[0].visible).toBe(true);
			s.windows[0].destroy();
			expect(await result).toBeNull();
			expect(s.savedRefs).toBe(0);
		},
	);
	it("inspects DOM after manual login and saves only after a valid notebook", async () => {
		const s = setup();
		const result = s.controller.ensureAuthenticated("co.jp");
		await tick();
		s.windows[0].navigate(
			urls("co.jp").notebookUrl,
			'<form name="signIn"></form>',
		);
		await tick();
		expect(s.secrets.size).toBe(0);
		Array.from(s.jars.values())[0].cookies.push(cookie);
		s.windows[0].navigate(urls("co.jp").notebookUrl, library);
		expect(await result).toBe(s.windows[0]);
		expect(s.secrets.size).toBe(1);
		expect(s.savedRefs).toBe(1);
	});
	it("does not overwrite an existing secret on network failure", async () => {
		const payload = record();
		const s = setup(payload);
		s.setRoute(() => {
			throw new Error("offline");
		});
		await expect(s.controller.ensureAuthenticated("co.jp")).rejects.toThrow(
			/load|network/i,
		);
		expect(s.secrets.get(s.secretIds["co.jp"])).toBe(payload);
		expect(s.windows[0].destroyed).toBe(true);
		await expect(s.controller.persist("co.jp")).rejects.toThrow();
	});
	it("requires exact notebook host/path, a library marker and absence of login or captcha", () => {
		const notebook = urls("co.jp").notebookUrl;
		expect(isAuthenticatedNotebook(notebook, library, notebook)).toBe(true);
		for (const url of [
			"https://read.amazon.co.jp.evil.test/notebook",
			"https://read.amazon.com/notebook",
			"https://read.amazon.co.jp/notebook-fake",
			"http://read.amazon.co.jp/notebook",
		])
			expect(isAuthenticatedNotebook(url, library, notebook)).toBe(false);
		for (const html of [
			"",
			library + '<input id="ap_password">',
			library + '<input id="captchacharacters">',
			library + '<form action="/ap/signin"></form>',
		])
			expect(isAuthenticatedNotebook(notebook, html, notebook)).toBe(
				false,
			);
	});
	it("keeps an authentication redirect or spoof hostname pending until user cancels", async () => {
		const s = setup(record());
		s.setRoute((url) => ({
			url: "https://read.amazon.co.jp.evil.test/notebook",
			html: library,
		}));
		const result = s.controller.ensureAuthenticated("co.jp");
		await tick();
		expect(s.windows[0].visible).toBe(true);
		s.windows[0].destroy();
		expect(await result).toBeNull();
	});
	it("separates region sessions and logout blanks only its secret and clears its partition", async () => {
		const s = setup(record());
		await s.controller.ensureAuthenticated("co.jp");
		const other = s.controller.ensureAuthenticated("com");
		await tick();
		const otherWindow = s.windows[1];
		await s.controller.logout("co.jp");
		expect(s.secrets.get(sessionKey("/vault/A", "co.jp"))).toBe("");
		expect(s.windows[0].destroyed).toBe(true);
		expect(otherWindow.destroyed).toBe(false);
		const jars = Array.from(s.jars.values());
		expect(jars[0].cleared).toBe(1);
		expect(jars[1].cleared).toBe(0);
		otherWindow.destroy();
		expect(await other).toBeNull();
	});
	it("dispose closes pending windows, settles cancellation and disallows future work", async () => {
		const s = setup();
		const result = s.controller.ensureAuthenticated("co.jp");
		await tick();
		s.controller.dispose();
		expect(await result).toBeNull();
		expect(s.windows.every((w) => w.destroyed)).toBe(true);
		await expect(s.controller.ensureAuthenticated("co.jp")).rejects.toThrow(
			/disposed/i,
		);
	});
	it("validates again when an authenticated session has expired", async () => {
		const s = setup(record());
		await s.controller.ensureAuthenticated("co.jp");
		s.setRoute((url) => ({
			url: "https://www.amazon.co.jp/ap/signin",
			html: '<form name="signIn"></form>',
		}));
		const result = s.controller.ensureAuthenticated("co.jp");
		await tick();
		expect(s.windows[0].visible).toBe(true);
		s.windows[0].destroy();
		expect(await result).toBeNull();
	});
	it("logout during secret restoration cancels pending authentication without creating an orphan window", async () => {
		const s = setup(record());
		let release!: (value: string) => void;
		s.setReadSecret(
			() => new Promise<string>((resolve) => (release = resolve)),
		);
		const pending = s.controller.ensureAuthenticated("co.jp");
		await tick();
		await s.controller.logout("co.jp");
		release(record());
		expect(await pending).toBeNull();
		expect(s.windows.length).toBe(0);
		expect(Array.from(s.jars.values())[0].cookies).toEqual([]);
	});
	it("inspects the newest finished page when an earlier DOM inspection is still pending", async () => {
		const s = setup();
		const pending = s.controller.ensureAuthenticated("co.jp");
		await tick();
		let release!: (value: string) => void;
		let first = true;
		s.windows[0].webContents.executeJavaScript = async () => {
			if (first) {
				first = false;
				return new Promise<string>((resolve) => (release = resolve));
			}
			return s.windows[0].html;
		};
		s.windows[0].navigate(
			"https://www.amazon.co.jp/ap/signin",
			'<form name="signIn"></form>',
		);
		s.windows[0].navigate(urls("co.jp").notebookUrl, library);
		release('<form name="signIn"></form>');
		await tick();
		expect(s.windows[0].visible).toBe(false);
		expect(await pending).toBe(s.windows[0]);
	});

	it("rejects an interactive main-frame network failure without overwriting its secret", async () => {
		const original = record();
		const s = setup(original);
		s.setRoute((url) => ({ url, html: '<form name="signIn"></form>' }));
		const pending = s.controller.ensureAuthenticated("co.jp");
		await tick();
		const rejection = expect(pending).rejects.toThrow(/network/i);
		s.windows[0].webContents.emit(
			"did-fail-load",
			{},
			-105,
			"private url omitted",
			"https://www.amazon.co.jp/ap/signin",
			true,
		);
		await rejection;
		expect(s.secrets.get(s.secretIds["co.jp"])).toBe(original);
		expect(s.windows[0].destroyed).toBe(true);
	});
	it("uses a safe remote fallback and creates isolated hardened desktop windows", async () => {
		const jar = { cookies: [], cleared: 0 };
		let options: any;
		let window!: FakeWindow;
		class DesktopWindow extends FakeWindow {
			constructor(config: any) {
				super(jar, (url) => ({
					url,
					html: '<form name="signIn"></form>',
				}));
				options = config;
				window = this;
			}
		}
		const remote = {
			BrowserWindow: DesktopWindow,
			session: {
				fromPartition: () => ({
					cookies: {
						get: async () => [],
						set: async () => undefined,
					},
					clearStorageData: async () => undefined,
					clearCache: async () => undefined,
				}),
			},
		};
		vi.stubGlobal("window", {
			require: (name: string) => {
				if (name === "electron")
					throw new Error("legacy bridge missing");
				if (name === "@electron/remote") return remote;
				throw new Error("unknown module");
			},
		});
		try {
			const app = {
				vault: { adapter: { getBasePath: () => "/vault/desktop" } },
				secretStorage: {
					getSecret: () => null,
					setSecret: () => undefined,
				},
			};
			const controller = createAmazonSession(
				app as any,
				urls,
				{},
				async () => undefined,
			);
			const pending = controller.ensureAuthenticated("co.jp");
			await tick();
			expect(options.webPreferences).toMatchObject({
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: true,
			});
			expect(options.webPreferences.partition).toMatch(
				/^kindle-session-[a-f0-9]+$/,
			);
			controller.dispose();
			expect(await pending).toBeNull();
			expect(window.destroyed).toBe(true);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("logout waits for an in-flight secret save so delayed writes cannot resurrect credentials", async () => {
		const s = setup(record());
		await s.controller.ensureAuthenticated("co.jp");
		let release!: () => void;
		s.setWriteSecret(async (id, payload) => {
			if (payload !== "")
				await new Promise<void>((resolve) => (release = resolve));
			s.secrets.set(id, payload);
		});
		const saving = s.controller.persist("co.jp");
		await tick();
		const loggingOut = s.controller.logout("co.jp");
		await tick();
		release();
		await saving;
		await loggingOut;
		expect(s.secrets.get(sessionKey("/vault/A", "co.jp"))).toBe("");
		expect(s.secretIds["co.jp"]).toBeUndefined();
	});

	it("clears its live session even when blanking the saved secret fails", async () => {
		const s = setup(record());
		await s.controller.ensureAuthenticated("co.jp");
		s.setWriteSecret(() =>
			Promise.reject(new Error("Secret storage unavailable")),
		);
		await expect(s.controller.logout("co.jp")).rejects.toThrow(/storage/i);
		expect(Array.from(s.jars.values())[0].cookies).toEqual([]);
		expect(s.windows[0].destroyed).toBe(true);
	});
});

it("blocks cross-region and external HTTP redirects in the isolated login window", async () => {
	const s = setup(record());
	await s.controller.ensureAuthenticated("co.jp");
	for (const url of [
		"https://www.amazon.com/ap/signin",
		"https://example.com/signin",
		"http://www.amazon.co.jp/ap/signin",
	]) {
		const event = { preventDefault: vi.fn() };
		s.windows[0].webContents.emit("will-redirect", event, url);
		expect(event.preventDefault).toHaveBeenCalled();
	}
	const allowed = { preventDefault: vi.fn() };
	s.windows[0].webContents.emit(
		"will-redirect",
		allowed,
		"https://www.amazon.co.jp/ap/signin",
	);
	expect(allowed.preventDefault).not.toHaveBeenCalled();
	s.controller.dispose();
});

it("settles pending login on disposal even when the window sends no closed notification", async () => {
	const s = setup();
	const pending = s.controller.ensureAuthenticated("co.jp");
	await tick();
	s.windows[0].destroy = () => {
		s.windows[0].destroyed = true;
	};
	let settled = false;
	void pending.then(() => {
		settled = true;
	});
	s.controller.dispose();
	await tick();
	expect(settled).toBe(true);
	expect(await pending).toBeNull();
});

it("verifies the notebook after login returns to a modern reader library path", async () => {
	const s = setup();
	const pending = s.controller.ensureAuthenticated("co.jp");
	await tick();
	s.windows[0].jar.cookies.push(cookie);
	s.windows[0].navigate(
		"https://read.amazon.co.jp/kindle-library",
		"<div>Reader library</div>",
	);
	let settled = false;
	void pending.then(() => {
		settled = true;
	});
	await tick();
	await tick();
	try {
		expect(settled).toBe(true);
		expect(await pending).toBe(s.windows[0] as any);
		expect(s.secretIds["co.jp"]).toBeTruthy();
	} finally {
		s.controller.dispose();
	}
});

it("rejects an invalid notebook instead of transitioning back to the same page", async () => {
	const s = setup();
	let notebookLoads = 0;
	s.setRoute((url) => {
		if (url.includes("/notebook")) notebookLoads++;
		return {
			url,
			html: url.includes("/notebook")
				? library
				: '<form name="signIn"></form>',
		};
	});
	const pending = s.controller.ensureAuthenticated("co.jp");
	await tick();
	const outcome = pending.then(
		() => false,
		() => true,
	);
	s.windows[0].navigate(
		"https://read.amazon.co.jp/notebook",
		"<div>Unavailable</div>",
	);
	await tick();
	await tick();
	try {
		expect(notebookLoads).toBe(0);
		expect(await outcome).toBe(true);
	} finally {
		s.controller.dispose();
	}
});

it("keeps regional Continue navigation inside its owned window despite the host browser router", async () => {
	const externalPages: string[] = [];
	const shared = new EventEmitter();
	const hostRouter = (event: { preventDefault(): void }, url: string) => {
		event.preventDefault();
		externalPages.push(url);
	};
	shared.on("will-navigate", hostRouter);
	const s = setup(record(), "/vault/A", (w) =>
		w.webContents.on("will-navigate", hostRouter),
	);
	await s.controller.ensureAuthenticated("co.jp");
	const event = { preventDefault: vi.fn() };
	s.windows[0].webContents.emit(
		"will-navigate",
		event,
		"https://www.amazon.co.jp/ap/signin",
	);
	expect(event.preventDefault).not.toHaveBeenCalled();
	expect(externalPages).toEqual([]);
	expect(shared.listeners("will-navigate")).toEqual([hostRouter]);
	for (const url of [
		"https://www.amazon.com/ap/signin",
		"https://example.com/",
		"http://www.amazon.co.jp/ap/signin",
	]) {
		const denied = { preventDefault: vi.fn() };
		s.windows[0].webContents.emit("will-navigate", denied, url);
		expect(denied.preventDefault).toHaveBeenCalled();
	}
	expect(externalPages).toEqual([]);
	s.controller.dispose();
});
