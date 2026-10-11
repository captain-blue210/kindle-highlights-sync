import { describe, expect, it } from "vitest";
import { mergeHighlights, kindleHash } from "./note-sync";
import type { Highlight } from "../models";

const h = (text: string, location = "10", note?: string): Highlight => ({
	id: "untrusted-generated-id",
	bookId: "ABC",
	text,
	location,
	note,
});

describe("source annotations independent of edited note text", () => {
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
			first.body.replace("> abc ", "> [[Related|My edited abc]] ") +
			"\nPersonal memo [[Other]]\n";
		const result = mergeHighlights(
			edited,
			[h("abc"), h("new", "20")],
			"ABC",
		);
		expect(result.added).toBe(1);
		expect(result.body).toContain("> [[Related|My edited abc]] ");
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
		const key = (result as any).heldAnnotations[0].sourceKey;
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
			bindings: { "bad-key": "old-id" },
		});
		expect(held.body).toBe(body);
		expect(
			held.heldAnnotations.some((a) => a.reason === "invalid-binding"),
		).toBe(true);
	});
});
