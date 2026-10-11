import type { Book } from "../models";
import {
	DEFAULT_PROPERTY_NAMES,
	PropertyNames,
	readNoteAsin,
} from "./note-properties";
import { findExistingNote, NoteSnapshot } from "./note-sync";

export type DestinationInvalidation =
	"renamed" | "deleted" | "missing" | "identity-changed" | "invalid";
export interface NoteDestination {
	fileId?: string;
	path: string;
	ctime: number | null;
	invalidated?: DestinationInvalidation;
}
export type NoteDestinations = Record<string, NoteDestination>;
export type DestinationHoldReason =
	| "destination-unselected"
	| "destination-missing"
	| "destination-identity-changed"
	| "destination-renamed"
	| "destination-deleted"
	| "destination-invalid";
export type DestinationResolution =
	| { status: "existing"; note: NoteSnapshot; explicit: boolean }
	| { status: "new" }
	| {
			status: "held";
			reason: DestinationHoldReason;
			candidates: string[];
			selectedPath?: string;
	  };
export interface DestinationGroup {
	asin: string;
	candidates: NoteSnapshot[];
	selected?: NoteDestination;
}

/** Retain malformed saved entries as tombstones rather than enabling fallback. */
export function readNoteDestinations(value: unknown): NoteDestinations {
	const result: NoteDestinations = Object.create(null);
	if (!value || typeof value !== "object" || Array.isArray(value))
		return result;
	for (const [asin, raw] of Object.entries(value)) {
		const v = raw as Partial<NoteDestination> | null;
		const valid =
			v &&
			typeof v.path === "string" &&
			v.path.endsWith(".md") &&
			typeof v.ctime === "number" &&
			Number.isFinite(v.ctime) &&
			v.ctime > 0 &&
			typeof v.fileId === "string" &&
			!!v.fileId;
		result[asin] = valid
			? {
					path: v.path!,
					fileId: v.fileId!,
					ctime: v.ctime!,
					...(v.invalidated
						? {
								invalidated: [
									"renamed",
									"deleted",
									"missing",
									"identity-changed",
								].includes(v.invalidated)
									? v.invalidated
									: "invalid",
							}
						: {}),
				}
			: {
					path: typeof v?.path === "string" ? v.path : "",
					ctime: null,
					invalidated: "invalid",
				};
	}
	return result;
}

export function noteAsin(
	note: NoteSnapshot,
	names: PropertyNames,
	history: PropertyNames[],
): string | undefined {
	try {
		return readNoteAsin(note.content, names, history);
	} catch {
		return undefined;
	}
}
export function groupNoteDestinations(
	notes: NoteSnapshot[],
	selections: NoteDestinations = {},
	names: PropertyNames = DEFAULT_PROPERTY_NAMES,
	history: PropertyNames[] = [],
): DestinationGroup[] {
	const groups = new Map<string, NoteSnapshot[]>();
	for (const note of notes) {
		const asin = noteAsin(note, names, history);
		if (asin) groups.set(asin, [...(groups.get(asin) ?? []), note]);
	}
	for (const asin of Object.keys(selections))
		if (!groups.has(asin)) groups.set(asin, []);
	return [...groups.entries()]
		.filter(
			([asin, ns]) =>
				ns.length > 1 ||
				Object.prototype.hasOwnProperty.call(selections, asin),
		)
		.map(([asin, candidates]) => ({
			asin,
			candidates: candidates.sort((a, b) => a.path.localeCompare(b.path)),
			selected: selections[asin],
		}));
}

export function resolveNoteDestination(
	notes: NoteSnapshot[],
	book: Book,
	selections: NoteDestinations = {},
	names: PropertyNames = DEFAULT_PROPERTY_NAMES,
	history: PropertyNames[] = [],
): DestinationResolution {
	const candidates = notes
		.filter((n) => noteAsin(n, names, history) === book.asin)
		.map((n) => n.path)
		.sort();
	const selected = Object.prototype.hasOwnProperty.call(selections, book.asin)
		? selections[book.asin]
		: undefined;
	const hold = (reason: DestinationHoldReason): DestinationResolution => ({
		status: "held",
		reason,
		candidates,
		...(selected ? { selectedPath: selected.path } : {}),
	});
	if (selected) {
		if (selected.invalidated)
			return hold(`destination-${selected.invalidated}`);
		const note = notes.find((n) => n.path === selected.path);
		if (!note) return hold("destination-missing");
		if (
			!selected.ctime ||
			!selected.fileId ||
			note.ctime !== selected.ctime ||
			(selected.fileId !== undefined &&
				note.fileId !== selected.fileId) ||
			noteAsin(note, names, history) !== book.asin
		)
			return hold("destination-identity-changed");
		return { status: "existing", note, explicit: true };
	}
	if (candidates.length > 1) return hold("destination-unselected");
	if (candidates.length === 1)
		return {
			status: "existing",
			note: notes.find((n) => n.path === candidates[0])!,
			explicit: false,
		};
	const note = findExistingNote(notes, book, names, history);
	return note
		? { status: "existing", note, explicit: false }
		: { status: "new" };
}

/** Invalidate exact paths and folder descendants; never follow or guess a relocation. */
export function invalidateNoteDestinations(
	selections: NoteDestinations,
	path: string,
	reason: "renamed" | "deleted",
): boolean {
	let changed = false;
	for (const selection of Object.values(selections)) {
		if (
			(selection.path === path ||
				selection.path.startsWith(path + "/")) &&
			!selection.invalidated
		) {
			selection.invalidated = reason;
			changed = true;
		}
	}
	return changed;
}
