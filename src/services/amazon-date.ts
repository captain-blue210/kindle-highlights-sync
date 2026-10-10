import moment from "moment";

/** Dates are calendar days. Parse independent of the store's display language. */
export function parseAmazonDate(
	input: string | undefined,
	_region: string,
): Date | null {
	if (!input?.trim()) return null;
	const text = input.trim().replace(/^Last annotated on\s*/i, "");
	const japanese = /^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s.*)?$/.exec(text);
	const candidate = japanese
		? `${japanese[1]}-${japanese[2].padStart(2, "0")}-${japanese[3].padStart(2, "0")}`
		: text.replace(
				/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/i,
				"",
			);
	const date = moment.utc(
		candidate,
		["YYYY-MM-DD", "MMMM D, YYYY", "MMM D, YYYY"],
		"en",
		true,
	);
	return date.isValid() ? date.toDate() : null;
}
