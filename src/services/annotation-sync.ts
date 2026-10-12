import { Buffer } from "buffer";
import type { Highlight } from "../models";
import {
	AnnotationCounts,
	countAnnotations,
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
	validAnchors: string[];
	linkableAnchors: string[];
	proof: string;
	unknown: boolean;
}
const keyPattern = /^s1-[a-f0-9]{64}$/;
const anchorPattern = /^[A-Za-z0-9-]+$/;
const targetId = (target: Target) =>
	"anchor" in target ? `a:${target.anchor}` : `p:${target.proof}`;
const candidateName = (block: LegacyBlock) =>
	block.anchors[0] ?? `block:${block.proof}`;

const mask = (text: string) => text.replace(/[^\r\n]/g, " ");
/** Mask code while retaining byte offsets for metadata replacement. Never write this projection. */
function markdownProjection(body: string): {
	exposed: string;
	openContext: boolean;
} {
	let fence: { marker: string; depth: number } | undefined;
	let exposed = body.replace(/[^\n]*(?:\n|$)/g, (line) => {
		const quotePrefix = /^(?: {0,3}>[ \t]?)+/.exec(line)?.[0] ?? "";
		const depth = (quotePrefix.match(/>/g) ?? []).length;
		const content = line.slice(quotePrefix.length).replace(/[\r\n]+$/, "");
		if (fence && depth < fence.depth) fence = undefined;
		const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
		if (fence) {
			if (
				match &&
				depth === fence.depth &&
				match[1][0] === fence.marker[0] &&
				match[1].length >= fence.marker.length &&
				!match[2].trim()
			)
				fence = undefined;
			return mask(line);
		}
		if (match && !(match[1][0] === "`" && match[2].includes("`"))) {
			fence = { marker: match[1], depth };
			return mask(line);
		}
		return /^(?: {4}|\t)/.test(content) ? mask(line) : line;
	});
	// CommonMark code spans close with the same length backtick run, including across lines.
	const runs = [...exposed.matchAll(/`+/g)];
	for (let i = 0; i < runs.length; i++) {
		const opening = runs[i];
		const escaped =
			/\\+$/.exec(exposed.slice(0, opening.index))?.[0].length ?? 0;
		if (escaped % 2) continue;
		const close = runs.findIndex(
			(r, index) => index > i && r[0].length === opening[0].length,
		);
		if (close < 0) continue;
		const start = opening.index!;
		const end = runs[close].index! + runs[close][0].length;
		exposed =
			exposed.slice(0, start) +
			mask(exposed.slice(start, end)) +
			exposed.slice(end);
		i = close;
	}
	const comments = [...exposed.matchAll(/<!--[\s\S]*?(?:-->|$)/g)];
	return {
		exposed,
		openContext: !!fence || comments.some((m) => !m[0].endsWith("-->")),
	};
}
const outsideFences = (body: string) => markdownProjection(body).exposed;
const visibleMarkdown = (body: string) =>
	outsideFences(body)
		.replace(/<!--[\s\S]*?(?:-->|$)/g, mask)
		.replace(/\r\n/g, "\n");
function scanBlocks(visible: string, asin: string): LegacyBlock[] {
	const blocks: LegacyBlock[] = [];
	const add = (block: string, quote: boolean) => {
		const anchors = [...block.matchAll(/\^([A-Za-z0-9-]+)(?=\s|$)/g)].map(
			(m) => m[1],
		);
		const validAnchors = [
			...block.matchAll(/(?:^|[ \t])\^([A-Za-z0-9-]+)(?=[ \t]*$)/gm),
		].map((m) => m[1]);
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
							// A later caption separator belongs to the suffix, not source text.
							/[ \t]*(?:[—–-][ \t]*(?:(?![—–]|[ \t]+-|-[ \t])[^:\r\n])+:[ \t]*)?\[[^\]\r\n]*\]\($/,
							"",
						)
				: block;
		// A paragraph split can leave its preceding horizontal rule attached.
		// Clean only the comparison text; keep raw block bytes for proof compatibility.
		if (!quote) text = text.replace(/^(?:[ \t]*-{3,}[ \t]*\r?\n)+/, "");
		text = normalizeSourceText(
			text.replace(/\^[A-Za-z0-9-]+(?=\s|$)/g, ""),
		);
		blocks.push({
			text,
			location,
			anchors,
			validAnchors,
			// Earlier inline quote IDs remain correspondence markers for legacy notes.
			// New templates must put an ID at the end of the quote or outside it.
			linkableAnchors: quote
				? [
						...block
							.slice(block.lastIndexOf("\n") + 1)
							.matchAll(
								/(?:^|[ \t])\^([A-Za-z0-9-]+)(?=[ \t]*$)/g,
							),
					].map((m) => m[1])
				: validAnchors,
			// Keep prior quote-only proof digests when a separate ID is attached.
			// Appending our own metadata changes paragraph separators, not the legacy block.
			proof: digest(
				(quote
					? block.replace(/\n[ \t]*\n\^[A-Za-z0-9-]+[ \t]*$/, "")
					: block).trim(),
			),
			unknown:
				quote &&
				!location &&
				!anchors.some((a) => /^(?:ref-\d+|ks-[a-f0-9]{64})$/.test(a)),
		});
	};
	const quotePattern = /^>.*(?:\n^>.*)*(?:\n[ \t]*\n\^[A-Za-z0-9-]+(?=[ \t]*(?:\n|$)))?/gm;
	for (const block of visible.match(quotePattern) ?? []) add(block, true);
	const withoutQuotes = visible.replace(quotePattern, "");
	for (const block of withoutQuotes.split(/\n\s*\n|\n---+\s*\n/)) {
		// An ID left alone after deleting its quote is not a saved target.
		if (/^\s*\^[A-Za-z0-9-]+\s*$/.test(block)) continue;
		if (block.trim()) add(block, false);
	}
	return blocks;
}
/** Unmarked paragraphs may be personal notes: require confirmation, never adopt them. */
function containsUnmarkedMemo(visible: string, text: string): boolean {
 const paragraphs = visible.split(/\n\s*\n/);
 const plain = (p: string) => !!p.trim() && !/^\s*(?:>|#{1,6} |---+\s*$)/m.test(p) && !/kindle:\/\/|\^[A-Za-z0-9-]+(?=\s|$)/.test(p);
 for (let i=0;i<paragraphs.length;i++) {
  let accumulated = "";
  for (let j=i;j<paragraphs.length && plain(paragraphs[j]);j++) {
   accumulated=normalizeSourceText(accumulated+" "+paragraphs[j]);
   if(accumulated===text) return true;
   if(accumulated.length>=text.length) break;
  }
 }
 return false;
}
function parseLedger(
	body: string,
	asin: string,
): { ledger: Ledger; marker?: { offset: number; length: number } } {
	const comments = [
		...outsideFences(body).matchAll(/<!--[\s\S]*?(?:-->|$)/g),
	];
	const markers = comments.filter((m) => /^<!--\s*kindle-sync:/.test(m[0]));
	if (!markers.length) {
		return { ledger: { version: 1, asin, entries: {} } };
	}
	if (markers.length !== 1) throw Error("Multiple ledgers");
	const match = /^<!-- kindle-sync:v1 ([^\r\n]*?) -->$/.exec(markers[0][0]);
	if (!match) throw Error("Invalid ledger marker");
	const payload = match[1];
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
	return {
		ledger: data,
		marker: { offset: markers[0].index!, length: markers[0][0].length },
	};
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
			addedCounts: countAnnotations([]),
			warnings: ["Invalid annotation ledger; note left unchanged"],
			heldAnnotations,
		};
	}
	const { ledger, marker } = state;
	const exposed = outsideFences(body);
	const visible = visibleMarkdown(body);
	if (markdownProjection(body).openContext) {
		hold("", "invalid-ledger");
		return {
			body,
			added: 0,
			addedCounts: countAnnotations([]),
			warnings: ["Unclosed Markdown context; note left unchanged"],
			heldAnnotations,
		};
	}
	const blocks = scanBlocks(visible, asin);
	const anchorCounts = new Map<string, number>();
	for (const block of blocks)
		for (const anchor of block.anchors)
			anchorCounts.set(anchor, (anchorCounts.get(anchor) ?? 0) + 1);
	const targetBlocks = (target: Target) =>
		blocks.filter((b) =>
			"anchor" in target
				? b.validAnchors.includes(target.anchor)
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
	const highlightTargets = new Set(
		remote
			.filter((a) => a.text?.trim())
			.flatMap((a) => {
				const target = ledger.entries[annotationKey(a, asin)];
				return [
					annotationAnchor(a, asin),
					...(target && "anchor" in target ? [target.anchor] : []),
				];
			}),
	);
	const memoTargets = new Set(
		remote
			.filter((a) => !a.text?.trim())
			.flatMap((a) => {
				const target = ledger.entries[annotationKey(a, asin)];
				return [
					annotationAnchor(a, asin),
					...(target && "anchor" in target ? [target.anchor] : []),
				];
			}),
	);

 const activeTargets = new Set<LegacyBlock>();
 const orphanedTargets = new Set<LegacyBlock>();
 for (const [key,target] of Object.entries(ledger.entries)) {
  for(const block of targetBlocks(target)) (keys.has(key) ? activeTargets : orphanedTargets).add(block);
 }
	const proposals: { key: string; block: LegacyBlock }[] = [];
	for (const h of remote) {
		const key = annotationKey(h, asin);
		if (ledger.entries[key]) continue;
		const loc = annotationLocation(h.location);
		const hash = "ref-" + kindleHash(h.text ?? "");
		const newAnchor = annotationAnchor(h, asin);
		const text = normalizeSourceText(annotationText(h));
		const exactAnchor = blocks.filter((b) =>
			b.validAnchors.includes(newAnchor),
		);
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
		const memo = !h.text?.trim();
  const sameKind = blocks.filter(b => memo
   ? !b.anchors.some(a => /^ref-/.test(a) || highlightTargets.has(a))
   : !b.anchors.some(a => memoTargets.has(a))
  );
  const candidates = sameKind.filter(b => memo
   ? !activeTargets.has(b) &&
    (b.text===text || (!!loc && b.location===loc && (!used.has(b) || orphanedTargets.has(b))) || (!loc && orphanedTargets.has(b)))
   : ((b.anchors.includes(hash) && (!b.location || b.location===loc)) || (loc && b.location===loc))
  );
  const personalMemoMatches = memo && containsUnmarkedMemo(visible,text);

		// A target occupied by another source is not a safe match, including source edits.
		const safe = candidates.filter(
			(b) =>
				!used.has(b) &&
				b.anchors.every((a) => anchorCounts.get(a) === 1) &&
				(b.text === text ||
					(!memo &&
						b.anchors.includes(hash) &&
						!!loc &&
						b.location === loc)),
		);
		// Count exact matches before excluding occupied/unsafe targets: a second
		// identical block must never become unambiguous merely because it is used.
		const exact = sameKind.filter(
			(b) => !!loc && b.location === loc && b.text === text,
		);
		const exactTarget = exact.length === 1 && safe.includes(exact[0]) &&
			(!memo || exact[0].anchors.length > 0) ? exact[0] : undefined;
		const fallbackTarget = exact.length === 0 && safe.length === 1 &&
			candidates.length === 1 && (!memo || safe[0].anchors.length > 0)
			? safe[0] : undefined;
		const target = exactTarget ?? fallbackTarget;
		if (target)
			proposals.push({ key, block: target });
		else if (
			candidates.length ||
			exact.length ||
			personalMemoMatches ||
			blocks.some((b) => b.unknown && !used.has(b))
		) {
			hold(
				key,
				"ambiguous-legacy",
				candidates.length || exact.length
					? [...new Set([...candidates, ...exact])].map(candidateName)
					: personalMemoMatches ? ["block:" + digest(text)] : blocks.filter((b) => b.unknown).map(candidateName),
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
			addedCounts: countAnnotations([]),
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
		return {
			body,
			added: 0,
			addedCounts: countAnnotations([]),
			warnings: [],
			heldAnnotations,
		};
	const encoded = `<!-- kindle-sync:v1 ${Buffer.from(JSON.stringify(ledger), "utf8").toString("base64")} -->`;
	// Modify only our own metadata, never the existing annotation blocks.
	merged = marker
		? merged.slice(0, marker.offset) +
			encoded +
			merged.slice(marker.offset + marker.length)
		: append(merged, encoded);
	// Even source text can contain Markdown that hides the newly rendered IDs. Confirm the final note.
	const finalBlocks = scanBlocks(visibleMarkdown(merged), asin);
	for (const [key, target] of Object.entries(ledger.entries)) {
		const matches = finalBlocks.filter((b) =>
			"anchor" in target
				? b.validAnchors.includes(target.anchor)
				: b.proof === target.proof,
		);
		if (
			matches.length !== 1 ||
			("anchor" in target &&
				finalBlocks
					.flatMap((b) => b.anchors)
					.filter((a) => a === target.anchor).length !== 1)
		)
			hold(key, "missing-target");
	}
	try {
		parseLedger(merged, asin);
	} catch {
		hold("", "invalid-ledger");
	}
	if (markdownProjection(merged).openContext || heldAnnotations.length)
		return {
			body,
			added: 0,
			addedCounts: countAnnotations([]),
			warnings: [
				"Rendered annotation targets are not visible; note left unchanged",
			],
			heldAnnotations,
		};
	return {
		body: merged,
		added: missing.length,
		addedCounts: countAnnotations(missing, asin),
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
	const visible = visibleMarkdown(body);
	const blocks = scanBlocks(visible, asin);
	const heldAnnotations: HeldAnnotation[] = [];
	for (const h of remote) {
		const anchor = annotationAnchor(h, asin);
		if (
			blocks.flatMap((b) => b.linkableAnchors).filter((a) => a === anchor)
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
			addedCounts: countAnnotations([]),
			warnings: ["Template must include every annotation exactly once"],
			heldAnnotations,
		};
	return reconcileAnnotations(body, remote, asin);
}
