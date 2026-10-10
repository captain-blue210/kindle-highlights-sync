import { describe, it, expect } from "vitest";
import { sessionKey, serializeCookies, restoreCookies } from "./session-store";
const cookie = {
	name: "session-id",
	value: "test-token",
	domain: ".amazon.co.jp",
	path: "/",
	secure: true,
	httpOnly: true,
	sameSite: "lax" as const,
	expirationDate: 2000,
};
describe("secret cookie records", () => {
	it("uses distinct lowercase opaque keys for each vault and region", () => {
		const keys = [
			sessionKey("/vault/A", "co.jp"),
			sessionKey("/vault/B", "co.jp"),
			sessionKey("/vault/A", "com"),
		];
		expect(new Set(keys).size).toBe(3);
		expect(
			keys.every((k) => /^[a-z0-9-]+$/.test(k) && !k.includes("vault")),
		).toBe(true);
		expect(sessionKey("/vault/A", "co.jp")).toBe(keys[0]);
	});
	it("restores all security attributes and excludes expired or foreign domains", () => {
		const payload = serializeCookies(
			[
				cookie,
				{ ...cookie, domain: ".amazon.com" },
				{ ...cookie, name: "expired", expirationDate: 1000 },
				{ ...cookie, name: "spoof", domain: "amazon.co.jp.evil.test" },
			],
			"co.jp",
			1500,
		);
		expect(restoreCookies(payload, "co.jp", 1500)).toEqual([cookie]);
	});
	it.each([
		"garbage",
		'{"version":1,"region":"com","cookies":[]}',
		'{"version":1,"region":"co.jp","cookies":[{"name":"bad"}]}',
	])("treats invalid secret safely: %s", (payload) => {
		expect(restoreCookies(payload, "co.jp", 1500)).toEqual([]);
	});
	it("retains valid session cookies and refuses malformed attributes", () => {
		const { expirationDate, ...sessionCookie } = cookie;
		const payload = serializeCookies(
			[
				sessionCookie,
				{ ...cookie, path: "bad" },
				{ ...cookie, sameSite: "invalid" as any },
				{ ...cookie, domain: "evilamazon.co.jp" },
			],
			"co.jp",
			1500,
		);
		expect(restoreCookies(payload, "co.jp", 1500)).toEqual([sessionCookie]);
	});
});
