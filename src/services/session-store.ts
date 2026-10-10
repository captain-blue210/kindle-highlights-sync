import { createHash } from "crypto";

/** The cookie subset that can be safely restored through Electron.cookies.set. */
export interface StoredCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	hostOnly?: boolean;
	expirationDate?: number;
	sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
}

export function sessionKey(vaultIdentity: string, region: string): string {
	return (
		"kindle-session-" +
		createHash("sha256")
			.update(JSON.stringify([vaultIdentity, region]))
			.digest("hex")
	);
}

export function approvedCookieDomain(domain: string, region: string): boolean {
	const host = domain.replace(/^\./, "").toLowerCase();
	const root = "amazon." + region;
	return (
		/^[a-z0-9.-]+$/.test(host) &&
		(host === root || host.endsWith("." + root))
	);
}

function validateCookie(
	value: unknown,
	region: string,
	nowSeconds: number,
): StoredCookie | null {
	if (!value || typeof value !== "object") return null;
	const c = value as Record<string, unknown>;
	if (
		typeof c.name !== "string" ||
		!c.name ||
		typeof c.value !== "string" ||
		typeof c.domain !== "string" ||
		!approvedCookieDomain(c.domain, region) ||
		typeof c.path !== "string" ||
		!c.path.startsWith("/") ||
		typeof c.secure !== "boolean" ||
		typeof c.httpOnly !== "boolean"
	)
		return null;
	if (
		c.expirationDate !== undefined &&
		(typeof c.expirationDate !== "number" ||
			!Number.isFinite(c.expirationDate) ||
			c.expirationDate <= nowSeconds)
	)
		return null;
	if (
		c.sameSite !== undefined &&
		!["unspecified", "no_restriction", "lax", "strict"].includes(
			c.sameSite as string,
		)
	)
		return null;
	if (c.hostOnly !== undefined && typeof c.hostOnly !== "boolean")
		return null;
	const cookie: StoredCookie = {
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		secure: c.secure,
		httpOnly: c.httpOnly,
	};
	if (c.expirationDate !== undefined)
		cookie.expirationDate = c.expirationDate as number;
	if (c.sameSite !== undefined)
		cookie.sameSite = c.sameSite as StoredCookie["sameSite"];
	if (c.hostOnly !== undefined) cookie.hostOnly = c.hostOnly as boolean;
	return cookie;
}

export function serializeCookies(
	cookies: unknown[],
	region: string,
	nowSeconds: number,
): string {
	return JSON.stringify({
		version: 1,
		region,
		cookies: cookies
			.map((c) => validateCookie(c, region, nowSeconds))
			.filter((c): c is StoredCookie => c !== null),
	});
}

export function restoreCookies(
	payload: string,
	region: string,
	nowSeconds: number,
): StoredCookie[] {
	try {
		const record = JSON.parse(payload);
		if (
			record?.version !== 1 ||
			record.region !== region ||
			!Array.isArray(record.cookies)
		)
			return [];
		return record.cookies
			.map((c: unknown) => validateCookie(c, region, nowSeconds))
			.filter((c: StoredCookie | null): c is StoredCookie => c !== null);
	} catch {
		return [];
	}
}
