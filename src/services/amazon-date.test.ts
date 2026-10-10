import { describe, it, expect } from "vitest";
import { parseAmazonDate } from "./amazon-date";
describe("Amazon annotation dates", () => {
	it.each([
		["Thursday, October 8, 2026", "co.jp", "2026-10-08"],
		["Thursday October 8, 2026", "co.jp", "2026-10-08"],
		["October 8, 2026", "com", "2026-10-08"],
		["Mar 29, 2025", "com", "2025-03-29"],
		["2025年3月29日 土曜日", "co.jp", "2025-03-29"],
		["2025年3月29日", "co.jp", "2025-03-29"],
		["2026-10-08", "co.jp", "2026-10-08"],
	])("parses %s for %s", (input, region, expected) =>
		expect(parseAmazonDate(input, region)?.toISOString().slice(0, 10)).toBe(
			expected,
		),
	);
	it.each([
		"Invalid date",
		"Thursday,",
		"2025年2月30日",
		"February 30, 2026",
		"",
		undefined,
	])("rejects invalid %s", (input) =>
		expect(parseAmazonDate(input, "co.jp")).toBeNull(),
	);
});
