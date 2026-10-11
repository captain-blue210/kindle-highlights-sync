import { expect, it } from "vitest";
import {
	groupNoteDestinations,
	resolveNoteDestination,
	readNoteDestinations,
	invalidateNoteDestinations,
} from "./note-destination";
import { DEFAULT_PROPERTY_NAMES as names } from "./note-properties";
const book = { id: "ABC", asin: "ABC", title: "Book" };
const notes = [
	{
		path: "books/A.md",
		fileId: "test-file",
		ctime: 10,
		content: "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nMemo\n",
	},
	{
		path: "books/B.md",
		fileId: "test-file",
		ctime: 20,
		content:
			"---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nOther memo\n",
	},
];
it("returns exactly the chosen path and content as a separate destination snapshot", () => {
	expect(
		resolveNoteDestination(notes, book, {
			ABC: { path: notes[1].path, fileId: "test-file", ctime: 20 },
		}),
	).toEqual({ status: "existing", explicit: true, note: notes[1] });
});
it("recognizes ASIN through customized property names and migration history", () => {
	const custom = { ...names, asin: "kindleAsin" };
	const changed = notes.map((n) => ({
		...n,
		content: n.content.replace("ASIN:", "kindleAsin:"),
	}));
	expect(resolveNoteDestination(changed, book, {}, custom).status).toBe(
		"held",
	);
	expect(
		resolveNoteDestination(notes, book, {}, custom, [names]).status,
	).toBe("held");
	expect(
		groupNoteDestinations(notes, {}, custom, [names])[0].candidates,
	).toEqual(notes);
});
it("keeps missing selected ASINs visible in the selection UI", () => {
	expect(
		groupNoteDestinations([], {
			ABC: { path: notes[0].path, fileId: "test-file", ctime: 10 },
		}),
	).toEqual([
		{
			asin: "ABC",
			candidates: [],
			selected: { path: notes[0].path, fileId: "test-file", ctime: 10 },
		},
	]);
});
it("preserves renamed/deleted tombstones even when the original path reappears", () => {
	const selected = {
		ABC: { path: notes[0].path, fileId: "test-file", ctime: 10 },
	};
	expect(invalidateNoteDestinations(selected, "books", "renamed")).toBe(true);
	const loaded = readNoteDestinations(JSON.parse(JSON.stringify(selected)));
	expect(resolveNoteDestination(notes, book, loaded)).toMatchObject({
		status: "held",
		reason: "destination-renamed",
	});
	expect(invalidateNoteDestinations(loaded, "books", "deleted")).toBe(false);
});
it.each([
	null,
	{},
	{ path: "books/A.md" },
	{ path: "books/A.md", ctime: Infinity },
	{ path: "books/A.md", ctime: 0 },
])(
	"holds invalid persisted entries without automatic fallback: %j",
	(entry) => {
		expect(
			resolveNoteDestination(
				notes.slice(0, 1),
				book,
				readNoteDestinations({ ABC: entry }),
			),
		).toMatchObject({ status: "held", reason: "destination-invalid" });
	},
);

it("requires explicit selection for all same-ASIN paths even without other book metadata", () => {
	const minimal = {
		path: "books/Minimal.md",
		fileId: "test-file",
		ctime: 30,
		content: "---\nASIN: ABC\ncustom: keep\n---\nMemo\n",
	};
	const all = [notes[0], minimal];
	expect(
		groupNoteDestinations(all)[0]?.candidates.map((n) => n.path),
	).toEqual([notes[0].path, minimal.path]);
	expect(resolveNoteDestination(all, book)).toMatchObject({
		status: "held",
		reason: "destination-unselected",
	});
	expect(
		resolveNoteDestination(all, book, {
			ABC: { path: minimal.path, fileId: "test-file", ctime: 30 },
		}),
	).toMatchObject({ status: "existing", note: minimal });
});

it("holds a persisted target replaced offline even with the same path, ASIN and creation time", () => {
	const selected = readNoteDestinations({
		ABC: { path: notes[0].path, ctime: 10, fileId: "original" },
	});
	const replacement = { ...notes[0], ctime: 10, fileId: "replacement" };
	expect(resolveNoteDestination([replacement], book, selected)).toMatchObject(
		{ status: "held", reason: "destination-identity-changed" },
	);
});
it("invalidates old persisted choices without a durable file identifier", () => {
	expect(
		readNoteDestinations({ ABC: { path: notes[0].path, ctime: 10 } }).ABC
			.invalidated,
	).toBe("invalid");
});
