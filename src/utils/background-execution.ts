interface HostContents {
	isDestroyed(): boolean;
	getBackgroundThrottling(): boolean;
	setBackgroundThrottling(allowed: boolean): void;
}

const leases = new WeakMap<HostContents, { users: number; original: boolean }>();

/** Keep the calling vault's timers active, without changing other vault windows. */
export function acquireBackgroundExecution(): () => void {
	const runtime = globalThis.window as unknown as { require?: (name: string) => any };
	let remote: any;
	try { remote = runtime?.require?.("electron")?.remote; } catch { /* Modern Electron uses the separate bridge. */ }
	if (!remote?.getCurrentWindow) {
		try { remote = runtime?.require?.("@electron/remote"); } catch { /* Report a safe failure below. */ }
	}
	const contents: HostContents | undefined = remote?.getCurrentWindow?.()?.webContents;
	if (!contents || contents.isDestroyed() ||
		typeof contents.getBackgroundThrottling !== "function" ||
		typeof contents.setBackgroundThrottling !== "function")
		throw new Error("Desktop background execution bridge unavailable");
	let lease = leases.get(contents);
	if (!lease) {
		const original = contents.getBackgroundThrottling();
		if (typeof original !== "boolean") throw new Error("Desktop background timer setting unavailable");
		try { contents.setBackgroundThrottling(false); }
		catch {
			// A bridge can throw after mutating the setting.
			if (!contents.isDestroyed()) contents.setBackgroundThrottling(original);
			throw new Error("Desktop background timers could not be enabled");
		}
		lease = { users: 0, original };
		leases.set(contents, lease);
	}
	lease.users++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--lease.users > 0) return;
		leases.delete(contents);
		if (!contents.isDestroyed()) contents.setBackgroundThrottling(lease.original);
	};
}
