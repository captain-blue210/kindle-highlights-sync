import { describe, expect, it } from "vitest";
import { mergeHighlights, kindleHash, renderHighlight } from "./note-sync";
import { annotationKey } from "./annotation-identity";
import { prepareNewNoteAnnotations } from "./annotation-sync";
import type { Highlight } from "../models";

const h = (text: string, location = "10", note?: string): Highlight => ({
	id: "untrusted-generated-id",
	bookId: "ABC",
	text,
	location,
	note,
});

describe("legacy plain Markdown comparison", () => {
	it.each(["\n", "\r\n"])("keeps source punctuation before the terminal location caption with %j", (newline) => {
		const cases = [
			{ text: "power-driven", separator: "—", label: "location" },
			{ text: "well - known", separator: "—", label: "location" },
			{ text: "suffi- ciently a curiosity", separator: "—", label: "location" },
			{ text: "alpha — aside", separator: "—", label: "location" },
			{ text: "alpha - middle", separator: "-", label: "location" },
			{ text: "alpha-beta", separator: "-", label: "kindle-location" },
			{ text: "prefix: power-driven", separator: "–", label: "location" },
			{ text: "--\npower-driven", separator: "—", label: "location" },
			{ text: "power-driven", separator: "—", label: "location", gap: "" },
			{ text: "alpha—aside", separator: "–", label: "location", gap: "" },
		];
		for (const {text, separator, label, gap = " "} of cases) {
			const body = `${text}${gap}${separator} ${label}: [10](kindle://book?action=open&asin=ABC&location=10) ^old-text\n`.replace(/\n/g, newline);
			const remote = [h(text)];
			const first = mergeHighlights(body, remote, "ABC");
			expect(first.warnings, text).toEqual([]);
			expect(first.added, text).toBe(0);
			expect(first.body.startsWith(body), text).toBe(true);
			const payload = first.body.match(/<!-- kindle-sync:v1 (\S+) -->/)![1];
			expect(Object.values(JSON.parse(Buffer.from(payload, "base64").toString()).entries), text)
				.toEqual([{ anchor: "old-text" }]);
			expect(mergeHighlights(first.body, remote, "ABC").body, text).toBe(first.body);
		}
	});
	it.each(["\n", "\r\n"])("reads text after a separator without changing %j bytes", (newline) => {
		const body = [
			"alpha — location: [10](kindle://book?action=open&asin=ABC&location=10) ^old-alpha",
			"", "---",
			"beta — location: [20](kindle://book?action=open&asin=ABC&location=20) ^old-beta",
			"",
		].join(newline);
		const remote = [h("alpha"), h("beta", "20")];
		const first = mergeHighlights(body, remote, "ABC");
		expect(first.warnings).toEqual([]);
		expect(first.added).toBe(0);
		expect(first.body.startsWith(body)).toBe(true);
		const payload = first.body.match(/<!-- kindle-sync:v1 (\S+) -->/)![1];
		expect(Object.values(JSON.parse(Buffer.from(payload, "base64").toString()).entries))
			.toEqual([{ anchor: "old-alpha" }, { anchor: "old-beta" }]);
		expect(mergeHighlights(first.body, remote, "ABC").body).toBe(first.body);
	});
	it("does not consume a literal dash line as a multiline location label", () => {
		const body = "--\nbeta — location: [20](kindle://book?action=open&asin=ABC&location=20) ^old-beta\n";
		const result = mergeHighlights(body, [h("--\nbeta", "20")], "ABC");
		expect(result.warnings).toEqual([]);
		expect(result.added).toBe(0);
		expect(result.body.startsWith(body)).toBe(true);
	});
	it("keeps a previously saved separator-prefixed plain proof ledger", () => {
		const body = "---\nbeta — location: [20](kindle://book?action=open&asin=ABC&location=20)\n\n" +
			"<!-- kindle-sync:v1 eyJ2ZXJzaW9uIjoxLCJhc2luIjoiQUJDIiwiZW50cmllcyI6eyJzMS03NmY0ZjdhNDk3Y2JhMGViN2Y4NzFhNzBjZjFhYjA0ZWQxNmI4NTNmYTNlYzkzYjI2N2EwYmViNmE2ZDU3MTc5Ijp7InByb29mIjoiYjU5MzQwNmJmZjA3OTVkNjExZmUyNmQ5Mjg4MDE4ZWExN2Q5YjhiZDUwMzQwMjA5MzRkNTk3ZDBiYTBkM2I3YSJ9fX0= -->\n";
		const repeated = mergeHighlights(body, [h("beta", "20")], "ABC");
		expect(repeated.warnings).toEqual([]);
		expect(repeated.body).toBe(body);
		const added = mergeHighlights(body, [h("beta", "20"), h("gamma", "30")], "ABC");
		expect(added.warnings).toEqual([]);
		expect(added.added).toBe(1);
		expect(added.body.startsWith(body.split("<!-- kindle-sync:v1")[0])).toBe(true);
	});
});

describe("unique exact legacy correspondence", () => {
	it.each(["plain", "quote"])("matches distinct %s texts sharing one location", (style) => {
		const body = style === "plain"
			? "alpha — location: [10](kindle://book?action=open&asin=ABC&location=10) ^old-alpha\n\n---\nbeta — location: [10](kindle://book?action=open&asin=ABC&location=10) ^old-beta\n"
			: "> alpha ^old-alpha\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n> beta ^old-beta\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const remote = [h("alpha"), h("beta")];
		const first = mergeHighlights(body, remote, "ABC");
		expect(first.warnings).toEqual([]);
		expect(first.added).toBe(0);
		expect(first.body.startsWith(body)).toBe(true);
		const payload = first.body.match(/<!-- kindle-sync:v1 (\S+) -->/)![1];
		expect(Object.values(JSON.parse(Buffer.from(payload, "base64").toString()).entries))
			.toEqual([{ anchor: "old-alpha" }, { anchor: "old-beta" }]);
		expect(mergeHighlights(first.body, remote, "ABC").body).toBe(first.body);
	});
	it("holds duplicate exact blocks instead of choosing the first", () => {
		const body = "> alpha ^old-first\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n> alpha ^old-second\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const result = mergeHighlights(body, [h("alpha")], "ABC");
		expect(result.body).toBe(body);
		expect(result.added).toBe(0);
		expect(result.heldAnnotations[0].reason).toBe("ambiguous-legacy");
	});
	it("counts an occupied exact block when deciding whether correspondence is unique", () => {
		const first = mergeHighlights("> gamma ^old-used\n> [10](kindle://book?action=open&asin=ABC&location=10)\n", [h("gamma")], "ABC");
		const body = first.body.replace("> gamma", "> alpha") + "> alpha ^old-free\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const result = mergeHighlights(body, [h("gamma"), h("alpha")], "ABC");
		expect(result.body).toBe(body);
		expect(result.heldAnnotations[0].reason).toBe("ambiguous-legacy");
	});
	it("holds a unique text when its old anchor is repeated elsewhere", () => {
		const body = "> alpha ^old-repeated\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n> beta ^old-repeated\n> [20](kindle://book?action=open&asin=ABC&location=20)\n";
		const result = mergeHighlights(body, [h("alpha"), h("beta", "20")], "ABC");
		expect(result.body).toBe(body);
		expect(result.heldAnnotations).toHaveLength(2);
	});
	it.each(["standalone", "attached"])("counts occupied %s memo blocks before deciding exact uniqueness", (kind) => {
		const highlight = kind === "attached"
			? "> abc ^ref-19495\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n" : "";
		const memoBlock = (text: string, anchor: string) =>
			`> ${text}\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n^${anchor}\n\n`;
		const before = kind === "attached" ? [h("abc", "10", "gamma")] : [h("", "10", "gamma")];
		const first = mergeHighlights(highlight + memoBlock("gamma", "old-used"), before, "ABC");
		expect(first.warnings).toEqual([]);
		const body = first.body.replace("> gamma", "> alpha") +
			memoBlock("alpha", "old-free") + memoBlock("unrelated", "old-other");
		const remote = kind === "attached"
			? [{ ...h("abc"), notes: ["gamma", "alpha"] }]
			: [h("", "10", "gamma"), h("", "10", "alpha")];
		const result = mergeHighlights(body, remote, "ABC");
		expect(result.body).toBe(body);
		expect(result.added).toBe(0);
		expect(result.heldAnnotations[0]?.reason).toBe("ambiguous-legacy");
	});
	it("keeps edited hash fallback conservative when another block shares the location", () => {
		const body = "> [[Related]] Edited abc ^ref-19495\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n> unrelated ^old-other\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const result = mergeHighlights(body, [h("abc")], "ABC");
		expect(result.body).toBe(body);
		expect(result.heldAnnotations[0].reason).toBe("ambiguous-legacy");
	});
	it("matches distinct anchored standalone memos at one location", () => {
		const body = "> first memo\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n^old-first-memo\n\n> second memo\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n^old-second-memo\n";
		const remote = [h("", "10", "first memo"), h("", "10", "second memo")];
		const result = mergeHighlights(body, remote, "ABC");
		expect(result.warnings).toEqual([]);
		expect(result.added).toBe(0);
		expect(result.body.startsWith(body)).toBe(true);
		expect(mergeHighlights(result.body, remote, "ABC").body).toBe(result.body);
	});
	it("does not treat a legacy highlight as an identically worded standalone memo", () => {
		const body = "> alpha ^ref-12345\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const result = mergeHighlights(body, [h("", "10", "alpha")], "ABC");
		expect(result.added).toBe(1);
		expect(result.body.startsWith(body)).toBe(true);
	});
});

describe("source annotations independent of edited note text", () => {
	it("retains an existing quote-only proof ledger when the user has a separate block ID", () => {
		// Captured from the previous implementation, before quote scanning attached separate IDs.
		const body = "> abc\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n^my-custom-id\n\n<!-- kindle-sync:v1 eyJ2ZXJzaW9uIjoxLCJhc2luIjoiQUJDIiwiZW50cmllcyI6eyJzMS0wMjE1YzY0YWRkN2QxNmMxODc1ZmE4MTEyMjBlM2Q0MGY2ZWI1YzBhZTc0NmU2ZTRhNTVlYTJlYmU5YTZhYTcwIjp7InByb29mIjoiMTJhY2ZkYjJiMzM5OGZhNTFjNGVjZTlkNGRmMzdjMTA4MmRlMzhmMGUwMzM4NDJlODYwM2ViMDY5ODU4NjZiMiJ9fX0= -->\n";
		const repeated = mergeHighlights(body, [h("abc")], "ABC");
		expect(repeated.warnings).toEqual([]);
		expect(repeated.body).toBe(body);
		const added = mergeHighlights(body, [h("abc"), h("new", "20")], "ABC");
		expect(added.warnings).toEqual([]);
		expect(added.added).toBe(1);
		expect(added.body).toContain(
			"> abc\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\n^my-custom-id",
		);
	});
	it("places a quotation block ID outside the quote before its attached note", () => {
		const rendered = renderHighlight(
			h("abc\nsecond line", "10", "My note"),
			"ABC",
		);
		expect(rendered).toMatch(
			/> abc\n> second line[\s\S]*\^ks-[a-f0-9]{64}\n\n> My note[\s\S]*\^ks-[a-f0-9]{64}$/,
		);
		const prepared = prepareNewNoteAnnotations(
			rendered,
			[h("abc\nsecond line", "10", "My note")],
			"ABC",
		);
		expect(prepared.warnings).toEqual([]);
	});
	it("holds a template ID followed by another line in the same quotation", () => {
		const body = `> abc ^ks-${"a".repeat(64)}\n> location\n`;
		// Use the generated ID but place it in the position Obsidian does not index.
		const anchor = renderHighlight(h("abc"), "ABC").match(
			/\^ks-[a-f0-9]{64}/,
		)![0];
		const invalid = body.replace(/\^ks-[a-f0-9]{64}/, anchor);
		const result = prepareNewNoteAnnotations(invalid, [h("abc")], "ABC");
		expect(result.body).toBe(invalid);
		expect(result.heldAnnotations[0]?.reason).toBe("missing-target");
	});
	it.each([
		"quote-fence",
		"indent",
		"inline",
		"invalid-close",
		"middle-of-line",
	])(
		"does not accept IDs in %s code examples as template targets",
		(context) => {
			const rendered = renderHighlight(h("abc"), "ABC");
			const anchor = rendered.match(/\^ks-[a-f0-9]{64}/)![0];
			const body =
				context === "quote-fence"
					? `> \`\`\`md\n> abc ${anchor}\n> \`\`\`\n`
					: context === "indent"
						? `    abc ${anchor}\n`
						: context === "inline"
							? `\`abc ${anchor} \`\n`
							: context === "middle-of-line"
								? `abc ${anchor} is only a sample ID\n`
								: `\`\`\`md\nexample\n\`\`\`not-a-closing-fence\n${rendered}\n`;
			const result = prepareNewNoteAnnotations(body, [h("abc")], "ABC");
			expect(result.body).toBe(body);
			expect(result.warnings.length).toBeGreaterThan(0);
		},
	);
	it.each(["Memo\n```text\nunfinished\n", "Memo\n<!-- unfinished\n"])(
		"holds an open Markdown context on every retry",
		(body) => {
			const first = mergeHighlights(body, [h("abc")], "ABC");
			expect(first.body).toBe(body);
			expect(first.added).toBe(0);
			expect(first.warnings.length).toBeGreaterThan(0);
			const second = mergeHighlights(first.body, [h("abc")], "ABC");
			expect(second.body).toBe(body);
			expect(second.added).toBe(0);
		},
	);
	it("updates the active ledger while keeping a preceding fenced ledger sample byte-for-byte", () => {
		const first = mergeHighlights("", [h("abc")], "ABC");
		const ledger = first.body.match(/<!-- kindle-sync:v1 .*? -->/)![0];
		const example = `My documentation\n\`\`\`md\n${ledger}\n\`\`\`\n\n`;
		const result = mergeHighlights(
			example + first.body,
			[h("abc"), h("new", "20")],
			"ABC",
		);
		expect(result.warnings).toEqual([]);
		expect(result.added).toBe(1);
		expect(result.body.startsWith(example)).toBe(true);
		expect(
			mergeHighlights(result.body, [h("abc"), h("new", "20")], "ABC")
				.body,
		).toBe(result.body);
	});
	it.each([
		"<!-- kindle-sync:v2 garbage -->",
		"<!-- kindle-sync:v1 not-valid",
	])("holds mixed valid and unsupported ledger state: %s", (invalid) => {
		const first = mergeHighlights("", [h("abc")], "ABC");
		const body = first.body + invalid + "\n";
		const result = mergeHighlights(body, [h("abc")], "ABC");
		expect(result.body).toBe(body);
		expect(result.heldAnnotations[0].reason).toBe("invalid-ledger");
	});
	it("keeps identical text at two locations and deduplicates page overlap", () => {
		const first = mergeHighlights(
			"",
			[h("abc"), h("abc"), h("abc", "20")],
			"ABC",
		);
		expect(first.added).toBe(2);
		expect(first.warnings).toEqual([]);
		const second = mergeHighlights(
			first.body,
			[h("abc"), h("abc", "20")],
			"ABC",
		);
		expect(second.added).toBe(0);
		expect(second.body).toBe(first.body);
	});
	it("imports distinct texts with the real Fletcher16 collision safely", () => {
		expect(kindleHash("aca")).toBe(kindleHash("bab"));
		const result = mergeHighlights("", [h("aca"), h("bab")], "ABC");
		expect(result.warnings).toEqual([]);
		expect(result.added).toBe(2);
		expect(
			new Set(
				[...result.body.matchAll(/\^ks-([a-f0-9]+)/g)].map((m) => m[1]),
			).size,
		).toBe(2);
	});
	it("keeps multiple standalone notes at one location and at other locations", () => {
		const remote = [
			h("", "10", "one note"),
			h("", "10", "two notes"),
			h("", "20", "one note"),
		];
		const result = mergeHighlights("", remote, "ABC");
		expect(result.added).toBe(3);
		expect(result.body).toContain("two notes");
		expect(mergeHighlights(result.body, remote, "ABC").added).toBe(0);
	});
	it("recognizes locally edited new blocks without hashing their display text", () => {
		const first = mergeHighlights("", [h("abc")], "ABC");
		const edited =
			first.body.replace("> abc", "> [[Related|My edited abc]]") +
			"\nPersonal memo [[Other]]\n";
		const result = mergeHighlights(
			edited,
			[h("abc"), h("new", "20")],
			"ABC",
		);
		expect(result.added).toBe(1);
		expect(result.body).toContain("> [[Related|My edited abc]]");
		expect(result.body).toContain("Personal memo [[Other]]");
	});
	it("holds a hash-only edited legacy block and reports a source key for explicit resolution", () => {
		const body = "> [[Related]] Edited abc ^ref-19495\n\nMemo\n";
		const result = mergeHighlights(body, [h("abc")], "ABC");
		expect(result.body).toBe(body);
		expect(result.added).toBe(0);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result).toMatchObject({
			heldAnnotations: [
				{ reason: "ambiguous-legacy", candidates: ["ref-19495"] },
			],
		});
		const key = result.heldAnnotations[0].sourceKey;
		const bound = body + `\n<!-- kindle-sync-bind: ${key} ^ref-19495 -->\n`;
		const resolved = mergeHighlights(bound, [h("abc")], "ABC");
		expect(resolved.warnings).toEqual([]);
		expect(resolved.added).toBe(0);
		expect(resolved.body.startsWith(body)).toBe(true);
		expect(mergeHighlights(resolved.body, [h("abc")], "ABC").body).toBe(
			resolved.body,
		);
	});
	it("holds two remote positions competing for one legacy hash-only block", () => {
		const body = "> abc ^ref-19495\n";
		const result = mergeHighlights(body, [h("abc"), h("abc", "20")], "ABC");
		expect(result.body).toBe(body);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
	it("uses old hash and location while retaining linked edited text and old block IDs", () => {
		const body =
			"> [[Related]] Edited abc ^ref-19495\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\nMy memo\n";
		const first = mergeHighlights(body, [h("abc"), h("abc", "20")], "ABC");
		expect(first.warnings).toEqual([]);
		expect(first.added).toBe(1);
		expect(first.body.startsWith(body)).toBe(true);
		expect(
			mergeHighlights(first.body, [h("abc"), h("abc", "20")], "ABC")
				.added,
		).toBe(0);
	});
	it("does not treat fenced or commented anchors as saved annotations", () => {
		const body =
			"```md\n> abc ^ref-19495\n```\n<!-- > abc ^ref-19495 -->\n";
		expect(mergeHighlights(body, [h("abc")], "ABC").added).toBe(1);
	});
	it("holds corrupted or foreign ledgers without changing any bytes", () => {
		for (const payload of [
			"not-base64",
			Buffer.from(
				JSON.stringify({ version: 2, asin: "ABC", entries: {} }),
			).toString("base64"),
			Buffer.from(
				JSON.stringify({ version: 1, asin: "OTHER", entries: {} }),
			).toString("base64"),
		]) {
			const body = `Memo\n<!-- kindle-sync:v1 ${payload} -->\n`;
			const result = mergeHighlights(body, [h("abc")], "ABC");
			expect(result.body).toBe(body);
			expect(result.warnings.length).toBeGreaterThan(0);
		}
	});
	it("recovers from a missing ledger using new anchors and holds a missing saved target", () => {
		const first = mergeHighlights("", [h("abc")], "ABC");
		const withoutLedger = first.body.replace(
			/<!-- kindle-sync:v1 .*? -->/g,
			"",
		);
		expect(mergeHighlights(withoutLedger, [h("abc")], "ABC").added).toBe(0);
		const withoutTarget = first.body.replace(/^>.*\n/gm, "");
		const held = mergeHighlights(withoutTarget, [h("abc")], "ABC");
		expect(held.body).toBe(withoutTarget);
		expect(held.warnings.length).toBeGreaterThan(0);
	});
	it("recovers distinct source anchors at the same location after ledger loss", () => {
		const remote = [h("aca"), h("bab")];
		const first = mergeHighlights("", remote, "ABC");
		const body = first.body.replace(/<!-- kindle-sync:v1 .*? -->/g, "");
		const recovered = mergeHighlights(body, remote, "ABC");
		expect(recovered.added).toBe(0);
		expect(recovered.warnings).toEqual([]);
	});
	it("can confirm a new annotation separately from a colliding old block", () => {
		const body =
			"> edited ^ref-19494\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const remote = [h("aca"), h("bab")];
		const held = mergeHighlights(body, remote, "ABC");
		expect(held.added).toBe(0);
		const [first, second] = held.heldAnnotations;
		expect(first.candidates).toEqual(["ref-19494"]);
		const confirmed =
			body +
			`\n<!-- kindle-sync-bind: ${first.sourceKey} ^ref-19494 -->\n<!-- kindle-sync-new: ${second.sourceKey} -->\n`;
		const result = mergeHighlights(confirmed, remote, "ABC");
		expect(result.warnings).toEqual([]);
		expect(result.added).toBe(1);
		expect(result.body.startsWith(body)).toBe(true);
		expect(mergeHighlights(result.body, remote, "ABC").added).toBe(0);
	});
	it("holds a duplicate legacy block ID rather than claiming both are one target", () => {
		const body =
			"> abc ^ref-19495 ^ref-19495\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const result = mergeHighlights(body, [h("abc")], "ABC");
		expect(result.body).toBe(body);
		expect(result.warnings.length).toBeGreaterThan(0);
	});
	it("retains identity when an attached Amazon note changes", () => {
		const first = mergeHighlights(
			"",
			[h("abc", "10", "old remote note")],
			"ABC",
		);
		const second = mergeHighlights(
			first.body,
			[h("abc", "10", "new remote note")],
			"ABC",
		);
		expect(second.added).toBe(0);
		expect(second.body).toBe(first.body);
		expect(second.body).toContain("old remote note");
	});
	it("preserves CRLF and existing custom block references during migration", () => {
		const body =
			"> abc ^my-custom-id\r\n> [10](kindle://book?action=open&asin=ABC&location=10)\r\n\r\n[[Book#^my-custom-id]]\r\n";
		const result = mergeHighlights(body, [h("abc"), h("new", "20")], "ABC");
		expect(result.added).toBe(1);
		expect(result.body.startsWith(body)).toBe(true);
		expect(result.body.replace(/\r\n/g, "")).not.toContain("\n");
		expect(
			mergeHighlights(result.body, [h("abc"), h("new", "20")], "ABC")
				.body,
		).toBe(result.body);
	});
	it("holds edits to unanchored migrated blocks until the user supplies an explicit block ID", () => {
		const body =
			"> abc\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const first = mergeHighlights(body, [h("abc")], "ABC");
		const edited = first.body.replace("> abc", "> [[Related|abc]]");
		const held = mergeHighlights(edited, [h("abc")], "ABC");
		expect(held.body).toBe(edited);
		expect(held.heldAnnotations[0].reason).toBe("missing-target");
		const anchored = edited.replace(
			"> [[Related|abc]]",
			"> [[Related|abc]] ^confirmed-old",
		);
		const resolved = mergeHighlights(anchored, [h("abc")], "ABC", {
			bindings: { [held.heldAnnotations[0].sourceKey]: "confirmed-old" },
		});
		expect(resolved.warnings).toEqual([]);
		expect(resolved.added).toBe(0);
		expect(resolved.body).toContain("> [[Related|abc]] ^confirmed-old");
	});
	it("does not accept two source bindings to the same old block", () => {
		const body = "> edited ^old-id\n";
		const held = mergeHighlights(body, [h("abc"), h("abc", "20")], "ABC", {
			bindings: {
				[annotationKey(h("abc"), "ABC")]: "old-id",
				[annotationKey(h("abc", "20"), "ABC")]: "old-id",
			},
		});
		expect(held.body).toBe(body);
		expect(
			held.heldAnnotations.some((a) => a.reason === "invalid-binding"),
		).toBe(true);
	});
	it("holds an edited custom-anchored legacy quote with no location", () => {
		const body = "> Edited abc ^my-old-block\n\n[[Book#^my-old-block]]\n";
		const result = mergeHighlights(body, [h("abc")], "ABC");
		expect(result.body).toBe(body);
		expect(result.heldAnnotations).toMatchObject([
			{ reason: "ambiguous-legacy", candidates: ["my-old-block"] },
		]);
	});
});

// #31: source memos need their own persisted target, including for an old highlight.
describe("independent attached memo persistence", () => {
	it("appends missing memos without changing an edited legacy highlight and repeats safely", () => {
		const body =
			"> [[Related|Edited abc]] ^ref-19495\n> [10](kindle://book?action=open&asin=ABC&location=10)\n\nPersonal memo\n";
		const remote = [
			h("abc", "10", "Kindle memo\n[link](https://example.com)"),
		];
		const first = mergeHighlights(body, remote, "ABC");
		expect(first.warnings).toEqual([]);
		expect(first.added).toBe(1);
		expect(first.body.startsWith(body)).toBe(true);
		expect(first.body).toContain(
			"> Kindle memo\n> [link](https://example.com)",
		);
		expect(mergeHighlights(first.body, remote, "ABC").body).toBe(
			first.body,
		);
	});
	it("creates a highlight and each distinct attached memo once", () => {
		const remote = [{ ...h("abc"), notes: ["one", "two", "one"] }];
		const first = mergeHighlights("", remote, "ABC");
		expect(first.added).toBe(3);
		expect([...first.body.matchAll(/\^ks-[a-f0-9]{64}/g)]).toHaveLength(3);
		expect(mergeHighlights(first.body, remote, "ABC").added).toBe(0);
	});
	it("holds a matching personal paragraph instead of silently adopting or duplicating it", () => {
		const first = mergeHighlights("", [h("abc")], "ABC");
		const body = first.body + "\nMy private memo\n";
		const result = mergeHighlights(
			body,
			[h("abc", "10", "My private memo")],
			"ABC",
		);
		expect(result.body).toBe(body);
		expect(result.heldAnnotations[0]?.reason).toBe("ambiguous-legacy");
	});
});

it("persists multiple standalone memos from the same row without merging with a same-text highlight", () => {
	const source = { ...h("", "10", "one"), notes: ["one", "two"] };
	const first = mergeHighlights("", [source], "ABC");
	expect(first.added).toBe(2);
	const second = mergeHighlights(first.body, [source, h("one")], "ABC");
	expect(second.warnings).toEqual([]);
	expect(second.added).toBe(1);
	expect(mergeHighlights(second.body, [source, h("one")], "ABC").body).toBe(
		second.body,
	);
});

describe("reviewed memo ambiguity cases", () => {
 it.each(['standalone','locationless attached'])('holds a changed %s memo without replacing or appending it', kind => {
  const before = kind==='standalone' ? [h('','10','old')] : [h('abc','','old')];
  const after = kind==='standalone' ? [h('','10','new')] : [h('abc','','new')];
  const first = mergeHighlights('',before,'ABC');
  const second = mergeHighlights(first.body,after,'ABC');
  expect(second.body).toBe(first.body);
  expect(second.added).toBe(0);
  expect(second.heldAnnotations[0]?.reason).toBe('ambiguous-legacy');
 });
 it.each(['attached','standalone'])('accepts an additional %s memo when the previously saved source remains',kind=>{
  const before = kind==='attached' ? [h('abc','10','one')] : [h('','10','one')];
  const after = kind==='attached' ? [{...h('abc'),notes:['one','two']}] : [h('','10','one'),h('','10','two')];
  const first = mergeHighlights('',before,'ABC');
  const second = mergeHighlights(first.body,after,'ABC');
  expect(second.warnings).toEqual([]);
  expect(second.added).toBe(1);
  expect(mergeHighlights(second.body,after,'ABC').body).toBe(second.body);
 });
 it('holds matching unmarked personal memos across paragraph boundaries',()=>{
  const first = mergeHighlights('',[h('abc')],'ABC');
  const body = first.body+'\nFirst paragraph\n\nSecond paragraph\n';
  const result=mergeHighlights(body,[h('abc','10','First paragraph\n\nSecond paragraph')],'ABC');
  expect(result.body).toBe(body);
  expect(result.heldAnnotations[0]?.reason).toBe('ambiguous-legacy');
 });
});
