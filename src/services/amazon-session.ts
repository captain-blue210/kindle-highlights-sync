import type { App } from "obsidian";
import type {
	BrowserWindow,
	BrowserWindowConstructorOptions,
	CookiesSetDetails,
} from "electron";
import { load } from "cheerio";
import {
	approvedCookieDomain,
	restoreCookies,
	serializeCookies,
	sessionKey,
} from "./session-store";

export interface AmazonRegionUrls {
	loginUrl: string;
	cloudReaderUrl: string;
	notebookUrl: string;
	logoutUrl: string;
}
export interface AmazonSessionController {
	ensureAuthenticated(region: string): Promise<BrowserWindow | null>;
	persist(region: string): Promise<void>;
	logout(region: string): Promise<void>;
	dispose(): void;
}
export interface SecretStoragePort {
	getSecret(id: string): string | null | Promise<string | null>;
	setSecret(id: string, value: string): void | Promise<void>;
}
export interface SessionPort {
	cookies: {
		get(filter: Record<string, never>): Promise<unknown[]>;
		set(cookie: CookiesSetDetails): Promise<void>;
	};
	clearStorageData(): Promise<void>;
	clearCache(): Promise<void>;
}
export interface AmazonSessionAdapters {
	vaultIdentity: string;
	urlsForRegion: (region: string) => AmazonRegionUrls | undefined;
	secrets: SecretStoragePort;
	secretIds: Record<string, string>;
	saveSecretRefs: () => Promise<void>;
	sessionForPartition: (partition: string) => SessionPort;
	createWindow: (partition: string) => BrowserWindow;
	now?: () => number;
}

const AUTH_FORMS =
	'form[name="signIn"], form[action*="/ap/signin"], #ap_password, #auth-captcha-image, #captchacharacters, form[action*="validateCaptcha"], #auth-mfa-otpcode';
function exactPage(url: string, target: string): boolean {
	try {
		const a = new URL(url),
			b = new URL(target);
		return (
			a.protocol === "https:" &&
			!a.username &&
			!a.password &&
			a.host === b.host &&
			a.pathname === b.pathname
		);
	} catch {
		return false;
	}
}
export function isAuthenticatedNotebook(
	url: string,
	html: string,
	notebookUrl: string,
): boolean {
	if (!exactPage(url, notebookUrl)) return false;
	const dom = load(html);
	return (
		dom(AUTH_FORMS).length === 0 && dom("#kp-notebook-library").length > 0
	);
}

interface RegionState {
	region: string;
	partition: string;
	session: SessionPort;
	window: BrowserWindow | null;
	restored: boolean;
	authenticated: boolean;
	pending?: Promise<BrowserWindow | null>;
	cancelPending?: () => void;
}

export function createAmazonSessionController(
	adapters: AmazonSessionAdapters,
): AmazonSessionController {
	const states = new Map<string, RegionState>();
	let disposed = false;
	const secretWrites = new Map<string, Promise<void>>();
	function writeSerially(
		region: string,
		write: () => Promise<void>,
	): Promise<void> {
		const previous = secretWrites.get(region) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(write);
		secretWrites.set(region, next);
		const cleanup = () => {
			if (secretWrites.get(region) === next) secretWrites.delete(region);
		};
		void next.then(cleanup, cleanup);
		return next;
	}
	const now = adapters.now ?? (() => Date.now() / 1000);
	const checkActive = () => {
		if (disposed) throw new Error("Amazon session controller disposed");
	};
	function stateFor(region: string): RegionState {
		checkActive();
		if (
			!adapters.urlsForRegion(region) ||
			!/^[a-z]+(?:\.[a-z]+)*$/.test(region)
		)
			throw new Error("Unsupported Amazon region");
		let state = states.get(region);
		if (!state) {
			const partition = sessionKey(adapters.vaultIdentity, region);
			state = {
				region,
				partition,
				session: adapters.sessionForPartition(partition),
				window: null,
				restored: false,
				authenticated: false,
			};
			states.set(region, state);
		}
		return state;
	}
	function destroy(state: RegionState) {
		state.cancelPending?.();
		state.cancelPending = undefined;
		state.authenticated = false;
		if (state.window && !state.window.isDestroyed()) state.window.destroy();
		state.window = null;
	}
	function active(state: RegionState) {
		return (
			!disposed &&
			states.get(state.region) === state &&
			!!state.window &&
			!state.window.isDestroyed()
		);
	}
	async function restore(region: string, state: RegionState) {
		if (state.restored) return;
		state.restored = true;
		const id = adapters.secretIds[region];
		// References must belong to this vault/region; copied settings cannot share auth.
		if (id !== sessionKey(adapters.vaultIdentity, region)) return;
		const payload = await adapters.secrets.getSecret(id);
		if (!payload) return;
		for (const cookie of restoreCookies(payload, region, now())) {
			if (disposed || states.get(region) !== state) return;
			const host = cookie.domain.replace(/^\./, "");
			const details: CookiesSetDetails = {
				url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`,
				name: cookie.name,
				value: cookie.value,
				path: cookie.path,
				secure: cookie.secure,
				httpOnly: cookie.httpOnly,
				expirationDate: cookie.expirationDate,
				sameSite: cookie.sameSite,
			};
			if (!cookie.hostOnly) details.domain = cookie.domain;
			await state.session.cookies.set(details);
		}
	}
	async function readPage(window: BrowserWindow) {
		const url = window.webContents.getURL();
		const html = await window.webContents.executeJavaScript(
			"document.documentElement.outerHTML",
		);
		return {
			url,
			html: typeof html === "string" ? html : "",
			unchanged:
				!window.isDestroyed() && url === window.webContents.getURL(),
		};
	}
	function loadNotebook(
		window: BrowserWindow,
		url: string,
		state: RegionState,
	): Promise<boolean | null> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (result: boolean | null, error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				clearInterval(lifecycle);
				if (state.cancelPending === closed)
					state.cancelPending = undefined;
				window.webContents.removeListener("destroyed", closed);
				window.removeListener("closed", closed);
				if (error) reject(error);
				else resolve(result);
			};
			const closed = () => finish(null);
			const timer = setTimeout(
				() =>
					finish(false, new Error("Amazon notebook load timed out")),
				60000,
			);
			const lifecycle = setInterval(() => {
				if (window.isDestroyed()) closed();
			}, 1000);
			state.cancelPending = closed;
			window.webContents.once("destroyed", closed);
			window.once("closed", closed);
			void window
				.loadURL(url)
				.then(async () => {
					if (settled || window.isDestroyed()) return;
					try {
						const page = await readPage(window);
						finish(
							page.unchanged &&
								isAuthenticatedNotebook(
									page.url,
									page.html,
									url,
								),
						);
					} catch {
						finish(
							false,
							new Error("Amazon notebook could not be inspected"),
						);
					}
				})
				.catch(() => {
					if (!settled)
						finish(
							false,
							new Error("Amazon notebook network load failed"),
						);
				});
		});
	}
	function interactive(
		window: BrowserWindow,
		urls: AmazonRegionUrls,
		state: RegionState,
	): Promise<BrowserWindow | null> {
		return new Promise((resolve, reject) => {
			let settled = false;
			let inspecting = false;
			let needsInspection = false;
			const finish = (result: BrowserWindow | null, error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				clearInterval(lifecycle);
				if (state.cancelPending === closed)
					state.cancelPending = undefined;
				window.webContents.removeListener("destroyed", closed);
				window.removeListener("closed", closed);
				window.webContents.removeListener("did-finish-load", loaded);
				window.webContents.removeListener("did-fail-load", failed);
				if (error) reject(error);
				else resolve(result);
			};
			const closed = () => finish(null);
			const failed = (
				_event: unknown,
				code: number,
				_description: string,
				_url: string,
				isMainFrame = true,
			) => {
				if (isMainFrame && code !== -3)
					finish(null, new Error("Amazon login network load failed"));
			};
			const loaded = async () => {
				if (settled || window.isDestroyed()) return;
				if (inspecting) {
					needsInspection = true;
					return;
				}
				inspecting = true;
				needsInspection = false;
				try {
					const page = await readPage(window);
					if (settled || !page.unchanged) return;
					if (
						isAuthenticatedNotebook(
							page.url,
							page.html,
							urls.notebookUrl,
						)
					) {
						window.hide();
						finish(window);
					} else if (
						exactPage(page.url, urls.notebookUrl) &&
						load(page.html)(AUTH_FORMS).length === 0
					) {
						finish(
							null,
							new Error("Amazon notebook content unavailable"),
						);
					} else if (
						new URL(page.url).origin ===
							new URL(urls.cloudReaderUrl).origin &&
						load(page.html)(AUTH_FORMS).length === 0
					) {
						inspecting = false;
						void window
							.loadURL(urls.notebookUrl)
							.catch(() =>
								finish(
									null,
									new Error(
										"Amazon notebook network load failed",
									),
								),
							);
					}
				} catch {
					if (!settled)
						finish(
							null,
							new Error("Amazon login could not be inspected"),
						);
				} finally {
					inspecting = false;
					if (needsInspection && !settled) void loaded();
				}
			};
			const timer = setTimeout(
				() => finish(null, new Error("Amazon login timed out")),
				10 * 60 * 1000,
			);
			const lifecycle = setInterval(() => {
				if (window.isDestroyed()) closed();
			}, 1000);
			state.cancelPending = closed;
			window.webContents.once("destroyed", closed);
			window.once("closed", closed);
			window.webContents.on("did-finish-load", loaded);
			window.webContents.on("did-fail-load", failed);
			window.show();
			void window.loadURL(urls.loginUrl).catch((error: unknown) => {
				if (
					!settled &&
					!window.isDestroyed() &&
					(error as { code?: string })?.code !== "ERR_ABORTED"
				)
					finish(null, new Error("Amazon login network load failed"));
			});
		});
	}
	async function persist(region: string): Promise<void> {
		const state = stateFor(region);
		if (!state.authenticated || !active(state))
			throw new Error("Amazon session is not authenticated");
		const cookies = await state.session.cookies.get({});
		if (!state.authenticated || !active(state))
			throw new Error("Amazon session is not authenticated");
		const id = sessionKey(adapters.vaultIdentity, region);
		await writeSerially(region, async () => {
			if (!state.authenticated || !active(state))
				throw new Error("Amazon session is not authenticated");
			await adapters.secrets.setSecret(
				id,
				serializeCookies(cookies, region, now()),
			);
			if (active(state) && adapters.secretIds[region] !== id) {
				adapters.secretIds[region] = id;
				await adapters.saveSecretRefs();
			}
		});
	}
	async function authenticate(
		region: string,
		state: RegionState,
	): Promise<BrowserWindow | null> {
		try {
			await restore(region, state);
			if (disposed || states.get(region) !== state) return null;
			checkActive();
			if (!state.window || state.window.isDestroyed()) {
				state.window = adapters.createWindow(state.partition);
				// Obsidian installs an external-browser router on every new window.
				// Replace it only on this newly created, exclusively owned login window;
				// otherwise form submissions leave the isolated session before our guard runs.
				state.window.webContents.removeAllListeners("will-navigate");
				state.window.webContents.setWindowOpenHandler?.(() => ({
					action: "deny",
				}));
				// Restrict navigation to this region's Amazon hosts, never external login pages.
				const guardNavigation = (
					event: { preventDefault(): void },
					url: string,
				) => {
					try {
						const parsed = new URL(url);
						if (
							parsed.protocol !== "https:" ||
							!approvedCookieDomain(parsed.hostname, region)
						)
							event.preventDefault();
					} catch {
						event.preventDefault();
					}
				};
				state.window.webContents.on("will-navigate", guardNavigation);
				state.window.webContents.on("will-redirect", guardNavigation);
			}
			const window = state.window;
			const urls = adapters.urlsForRegion(region)!;
			state.authenticated = false;
			const cookies = await state.session.cookies.get({});
			if (!active(state)) return null;
			if (cookies.length) {
				const valid = await loadNotebook(
					window,
					urls.notebookUrl,
					state,
				);
				if (valid === null) return null;
				if (valid) {
					state.authenticated = true;
					await persist(region);
					return window;
				}
			}
			const result = await interactive(window, urls, state);
			if (result && active(state)) {
				state.authenticated = true;
				await persist(region);
				return result;
			}
			return null;
		} catch (error) {
			destroy(state);
			throw error;
		}
	}
	const controller: AmazonSessionController = {
		ensureAuthenticated(region) {
			try {
				const state = stateFor(region);
				if (state.pending) return state.pending;
				const operation = authenticate(region, state).finally(() => {
					state.pending = undefined;
				});
				state.pending = operation;
				return operation;
			} catch (error) {
				return Promise.reject(error);
			}
		},
		persist,
		async logout(region) {
			const state = stateFor(region);
			states.delete(region);
			destroy(state);
			const id = sessionKey(adapters.vaultIdentity, region);
			await Promise.all([
				writeSerially(region, async () => {
					await adapters.secrets.setSecret(id, "");
				}),
				state.session.clearStorageData(),
				state.session.clearCache(),
			]);
			if (adapters.secretIds[region] !== undefined) {
				delete adapters.secretIds[region];
				await adapters.saveSecretRefs();
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const state of states.values()) {
				destroy(state);
				void state.session.clearStorageData().catch(() => undefined);
			}
			states.clear();
		},
	};
	return controller;
}

/** Desktop bridge: secrets use only Obsidian's public SecretStorage API. */
export function createAmazonSession(
	app: App,
	urlsForRegion: (region: string) => AmazonRegionUrls | undefined,
	secretIds: Record<string, string>,
	saveSecretRefs: () => Promise<void>,
): AmazonSessionController {
	const runtimeWindow = globalThis.window as unknown as {
		require?: (name: string) => any;
	};
	let remote: any;
	try {
		remote = runtimeWindow?.require?.("electron")?.remote;
	} catch {
		remote = undefined;
	}
	if (!remote?.BrowserWindow || !remote?.session) {
		try {
			remote = runtimeWindow?.require?.("@electron/remote");
		} catch {
			remote = undefined;
		}
	}
	if (!remote?.BrowserWindow || !remote?.session)
		throw new Error("Electron desktop session bridge unavailable");
	const secrets = (app as App & { secretStorage?: SecretStoragePort })
		.secretStorage;
	if (!secrets)
		throw new Error(
			"Obsidian SecretStorage requires desktop Obsidian 1.11.4 or newer",
		);
	const adapter = app.vault.adapter as unknown as {
		getBasePath?: () => string;
	};
	const vaultIdentity = adapter.getBasePath?.();
	if (!vaultIdentity)
		throw new Error("Desktop vault filesystem identity unavailable");
	return createAmazonSessionController({
		vaultIdentity,
		urlsForRegion,
		secrets,
		secretIds,
		saveSecretRefs,
		sessionForPartition: (partition) =>
			remote.session.fromPartition(partition),
		createWindow: (partition) => {
			const options: BrowserWindowConstructorOptions = {
				parent: remote.getCurrentWindow?.(),
				width: 850,
				height: 800,
				show: false,
				webPreferences: {
					partition,
					nodeIntegration: false,
					contextIsolation: true,
					sandbox: true,
				},
			};
			return new remote.BrowserWindow(options);
		},
	});
}
