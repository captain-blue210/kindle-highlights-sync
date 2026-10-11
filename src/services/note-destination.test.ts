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
		ctime: 10,
		content: "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nMemo\n",
	},
	{
		path: "books/B.md",
		ctime: 20,
		content:
			"---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nOther memo\n",
	},
];
it("returns exactly the chosen path and content as a separate destination snapshot", () => {
	expect(
		resolveNoteDestination(notes, book, {
			ABC: { path: notes[1].path, ctime: 20 },
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
		groupNoteDestinations([], { ABC: { path: notes[0].path, ctime: 10 } }),
	).toEqual([
		{
			asin: "ABC",
			candidates: [],
			selected: { path: notes[0].path, ctime: 10 },
		},
	]);
});
it("preserves renamed/deleted tombstones even when the original path reappears", () => {
	const selected = { ABC: { path: notes[0].path, ctime: 10 } };
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
