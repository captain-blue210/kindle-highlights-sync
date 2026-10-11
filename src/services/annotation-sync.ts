import { Buffer } from "buffer";
import type { Highlight } from "../models";
import {
	annotationAnchor,
	annotationKey,
	annotationLocation,
	annotationText,
	digest,
	kindleHash,
	normalizeSourceText,
	renderAnnotation,
	uniqueAnnotations,
} from "./annotation-identity";

export interface HeldAnnotation {
	sourceKey: string;
	reason:
		| "ambiguous-legacy"
		| "missing-target"
		| "invalid-ledger"
		| "invalid-binding";
	candidates: string[];
}
export interface AnnotationSyncOptions {
	/** Explicit, user-confirmed correspondence to an existing block ID, without ^. */
	bindings?: Record<string, string>;
	/** Explicit confirmation that an ambiguous source has no existing saved block. */
	newSourceKeys?: string[];
}
type Target = { anchor: string } | { proof: string };
interface Ledger {
	version: 1;
	asin: string;
	entries: Record<string, Target>;
}
interface LegacyBlock {
	text: string;
	location?: string;
	anchors: string[];
	proof: string;
	unknown: boolean;
}
const keyPattern = /^s1-[a-f0-9]{64}$/;
const anchorPattern = /^[A-Za-z0-9-]+$/;
const targetId = (target: Target) =>
	"anchor" in target ? `a:${target.anchor}` : `p:${target.proof}`;
const candidateName = (block: LegacyBlock) =>
	block.anchors[0] ?? `block:${block.proof}`;

/** Remove fences without modifying the saved note. Comments are handled separately. */
function outsideFences(body: string): string {
	let fence: string | undefined;
	return body
		.split(/\r?\n/)
		.map((line) => {
			const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
			if (match) {
				if (!fence) fence = match[1];
				else if (
					match[1][0] === fence[0] &&
					match[1].length >= fence.length
				)
					fence = undefined;
				return "";
			}
			return fence ? "" : line;
		})
		.join("\n");
}
function scanBlocks(visible: string, asin: string): LegacyBlock[] {
	const blocks: LegacyBlock[] = [];
	const add = (block: string, quote: boolean) => {
		const anchors = [...block.matchAll(/\^([A-Za-z0-9-]+)(?=\s|$)/g)].map(
			(m) => m[1],
		);
		const link = /kindle:\/\/book\?[^\s)]+/.exec(block);
		let location: string | undefined;
		if (link) {
			try {
				const url = new URL(link[0]);
				if (url.searchParams.get("asin") !== asin) return;
				const loc = url.searchParams.get("location");
				if (loc) location = annotationLocation(loc);
			} catch {
				return;
			}
		}
		let text = quote
			? block
					.split("\n")
					.filter((l) => !l.includes("kindle://"))
					.map((l) => l.replace(/^>\s?/, ""))
					.join("\n")
			: link
				? block
						.slice(0, link.index)
						.replace(
							/\s*(?:[—–-]\s*[^:\n]+:\s*)?\[[^\]\n]*\]\($/,
							"",
						)
				: block;
		text = normalizeSourceText(
			text.replace(/\^[A-Za-z0-9-]+(?=\s|$)/g, ""),
		);
		blocks.push({
			text,
			location,
			anchors,
			proof: digest(block),
			unknown: quote && !location && !anchors.length,
		});
	};
	const quotePattern = /^>.*(?:\n^>.*)*/gm;
	for (const block of visible.match(quotePattern) ?? []) add(block, true);
	const withoutQuotes = visible.replace(quotePattern, "");
	for (const block of withoutQuotes.split(/\n\s*\n|\n---+\s*\n/)) {
		if (
			block.includes("kindle://") ||
			/\^[A-Za-z0-9-]+(?=\s|$)/.test(block)
		)
			add(block, false);
	}
	return blocks;
}
function parseLedger(
	body: string,
	asin: string,
): { ledger: Ledger; raw?: string } {
	const matches = [
		...outsideFences(body).matchAll(/<!-- kindle-sync:v1 ([^\n]*?) -->/g),
	];
	if (!matches.length) {
		if (/<!--\s*kindle-sync:/.test(outsideFences(body)))
			throw Error("Invalid ledger marker");
		return { ledger: { version: 1, asin, entries: {} } };
	}
	if (matches.length !== 1) throw Error("Multiple ledgers");
	const payload = matches[0][1];
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload))
		throw Error("Invalid ledger encoding");
	const data = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
	if (
		data.version !== 1 ||
		data.asin !== asin ||
		!data.entries ||
		typeof data.entries !== "object" ||
		Array.isArray(data.entries)
	)
		throw Error("Invalid ledger identity");
	const seen = new Set<string>();
	for (const [key, value] of Object.entries(data.entries)) {
		const target = value as Target;
		if (
			!keyPattern.test(key) ||
			!target ||
			typeof target !== "object" ||
			Array.isArray(target) ||
			Object.keys(target).length !== 1 ||
			!("anchor" in target
				? typeof target.anchor === "string" &&
					anchorPattern.test(target.anchor)
				: "proof" in target &&
					typeof target.proof === "string" &&
					/^[a-f0-9]{64}$/.test(target.proof))
		)
			throw Error("Invalid ledger entry");
		if (seen.has(targetId(target)))
			throw Error("Non-unique correspondence");
		seen.add(targetId(target));
	}
	return { ledger: data, raw: matches[0][0] };
}
function append(body: string, suffix: string): string {
	const nl = body.includes("\r\n") ? "\r\n" : "\n";
	return (
		body +
		(body.endsWith(nl + nl)
			? ""
			: body.endsWith(nl)
				? nl
				: body
					? nl + nl
					: "") +
		suffix.replace(/\n/g, nl) +
		nl
	);
}

export function reconcileAnnotations(
	body: string,
	highlights: Highlight[],
	asin: string,
	options: AnnotationSyncOptions = {},
) {
	const remote = uniqueAnnotations(highlights, asin);
	const heldAnnotations: HeldAnnotation[] = [];
	const hold = (
		sourceKey: string,
		reason: HeldAnnotation["reason"],
		candidates: string[] = [],
	) => heldAnnotations.push({ sourceKey, reason, candidates });
	let state: ReturnType<typeof parseLedger>;
	try {
		state = parseLedger(body, asin);
	} catch {
		hold("", "invalid-ledger");
		return {
			body,
			added: 0,
			warnings: ["Invalid annotation ledger; note left unchanged"],
			heldAnnotations,
		};
	}
	const { ledger, raw } = state;
	const exposed = outsideFences(body);
	const visible = exposed.replace(/<!--[\s\S]*?-->/g, "");
	const blocks = scanBlocks(visible, asin);
	const anchorCounts = new Map<string, number>();
	for (const block of blocks)
		for (const anchor of block.anchors)
			anchorCounts.set(anchor, (anchorCounts.get(anchor) ?? 0) + 1);
	const targetBlocks = (target: Target) =>
		blocks.filter((b) =>
			"anchor" in target
				? b.anchors.includes(target.anchor)
				: b.proof === target.proof,
		);
	const used = new Set<LegacyBlock>();
	const unresolved = new Map<string, string[]>();
	for (const [key, target] of Object.entries(ledger.entries)) {
		const matches = targetBlocks(target);
		if (
			matches.length !== 1 ||
			used.has(matches[0]) ||
			("anchor" in target && anchorCounts.get(target.anchor) !== 1)
		)
			unresolved.set(key, matches.map(candidateName));
		else used.add(matches[0]);
	}
	const bindings = new Map(Object.entries(options.bindings ?? {}));
	for (const m of exposed.matchAll(
		/<!-- kindle-sync-bind: (\S+) \^([A-Za-z0-9-]+) -->/g,
	)) {
		if (bindings.has(m[1]) && bindings.get(m[1]) !== m[2])
			hold(m[1], "invalid-binding", [m[2]]);
		bindings.set(m[1], m[2]);
	}
	const keys = new Set(remote.map((h) => annotationKey(h, asin)));
	for (const [key, anchor] of bindings) {
		if (
			!keyPattern.test(key) ||
			!anchorPattern.test(anchor) ||
			(!keys.has(key) && !ledger.entries[key])
		) {
			hold(key, "invalid-binding", [anchor]);
			continue;
		}
		if (ledger.entries[key] && !unresolved.has(key)) {
			if (
				!("anchor" in ledger.entries[key]) ||
				(ledger.entries[key] as { anchor: string }).anchor !== anchor
			)
				hold(key, "invalid-binding", [anchor]);
			continue;
		}
		const matches = targetBlocks({ anchor });
		if (
			matches.length !== 1 ||
			used.has(matches[0]) ||
			anchorCounts.get(anchor) !== 1
		) {
			hold(key, "invalid-binding", [anchor]);
			continue;
		}
		ledger.entries[key] = { anchor };
		unresolved.delete(key);
		used.add(matches[0]);
	}
	for (const [key, candidates] of unresolved)
		hold(key, "missing-target", candidates);
	const missing: Highlight[] = [];
	const confirmedNew = new Set(options.newSourceKeys ?? []);
	for (const m of exposed.matchAll(/<!-- kindle-sync-new: (\S+) -->/g))
		confirmedNew.add(m[1]);
	for (const key of confirmedNew)
		if (
			!keyPattern.test(key) ||
			(!keys.has(key) && !ledger.entries[key]) ||
			bindings.has(key)
		)
			hold(key, "invalid-binding");
	const proposals: { key: string; block: LegacyBlock }[] = [];
	for (const h of remote) {
		const key = annotationKey(h, asin);
		if (ledger.entries[key]) continue;
		const loc = annotationLocation(h.location);
		const hash = "ref-" + kindleHash(h.text ?? "");
		const newAnchor = annotationAnchor(h, asin);
		const text = normalizeSourceText(annotationText(h));
		const exactAnchor = blocks.filter((b) => b.anchors.includes(newAnchor));
		if (exactAnchor.length) {
			if (
				exactAnchor.length !== 1 ||
				anchorCounts.get(newAnchor) !== 1 ||
				used.has(exactAnchor[0])
			)
				hold(key, "ambiguous-legacy", [newAnchor]);
			else proposals.push({ key, block: exactAnchor[0] });
			continue;
		}
		if (confirmedNew.has(key)) {
			missing.push(h);
			continue;
		}
		const candidates = blocks.filter(
			(b) =>
				(b.anchors.includes(hash) &&
					(!b.location || b.location === loc)) ||
				(loc && b.location === loc),
		);
		// A target occupied by another source is not a safe match, including source edits.
		const safe = candidates.filter(
			(b) =>
				!used.has(b) &&
				b.anchors.every((a) => anchorCounts.get(a) === 1) &&
				(b.text === text ||
					(b.anchors.includes(hash) && !!loc && b.location === loc)),
		);
		if (safe.length === 1 && candidates.length === 1)
			proposals.push({ key, block: safe[0] });
		else if (
			candidates.length ||
			blocks.some((b) => b.unknown && !used.has(b))
		) {
			hold(
				key,
				"ambiguous-legacy",
				candidates.length
					? candidates.map(candidateName)
					: blocks.filter((b) => b.unknown).map(candidateName),
			);
		} else missing.push(h);
	}
	for (const { key, block } of proposals) {
		if (proposals.filter((p) => p.block === block).length !== 1)
			hold(key, "ambiguous-legacy", [candidateName(block)]);
		else
			ledger.entries[key] = block.anchors.length
				? { anchor: block.anchors[0] }
				: { proof: block.proof };
	}
	// Whole-note hold: never partially advance the ledger or append before a resolution.
	if (heldAnnotations.length)
		return {
			body,
			added: 0,
			warnings: [
				"Annotation correspondence requires confirmation; note left unchanged",
			],
			heldAnnotations,
		};
	let merged = body;
	if (missing.length) {
		merged = append(
			merged,
			missing.map((h) => renderAnnotation(h, asin)).join("\n\n"),
		);
		for (const h of missing)
			ledger.entries[annotationKey(h, asin)] = {
				anchor: annotationAnchor(h, asin),
			};
	}
	if (!Object.keys(ledger.entries).length)
		return { body, added: 0, warnings: [], heldAnnotations };
	const encoded = `<!-- kindle-sync:v1 ${Buffer.from(JSON.stringify(ledger), "utf8").toString("base64")} -->`;
	// Modify only our own metadata, never the existing annotation blocks.
	merged = raw ? merged.replace(raw, encoded) : append(merged, encoded);
	return {
		body: merged,
		added: missing.length,
		warnings: [],
		heldAnnotations,
	};
}

/** A custom template must actually include each annotation once before creation. */
export function prepareNewNoteAnnotations(
	body: string,
	highlights: Highlight[],
	asin: string,
) {
	const remote = uniqueAnnotations(highlights, asin);
	const visible = outsideFences(body).replace(/<!--[\s\S]*?-->/g, "");
	const blocks = scanBlocks(visible, asin);
	const heldAnnotations: HeldAnnotation[] = [];
	for (const h of remote) {
		const anchor = annotationAnchor(h, asin);
		if (
			blocks.flatMap((b) => b.anchors).filter((a) => a === anchor)
				.length !== 1
		)
			heldAnnotations.push({
				sourceKey: annotationKey(h, asin),
				reason: "missing-target",
				candidates: [anchor],
			});
	}
	if (heldAnnotations.length)
		return {
			body,
			added: 0,
			warnings: ["Template must include every annotation exactly once"],
			heldAnnotations,
		};
	return reconcileAnnotations(body, remote, asin);
}
