import { describe, it, expect } from "vitest";
import { saveBookNotes } from "./note-writer";
import {
	DEFAULT_PROPERTY_NAMES as names,
	readBookProperties,
	splitNote,
} from "./note-properties";
const book = {
	id: "ABC",
	asin: "ABC",
	title: "Renamed Book",
	lastAnnotatedDate: new Date("2026-10-08T00:00:00Z"),
};
const highlight = { id: "legacy", bookId: "ABC", text: "abc", location: "10" };
function memoryVault(initial: Record<string, string> = {}) {
	const files = new Map(Object.entries(initial));
	return {
		files,
		fileIdentity: () => "test-file",
		list: () => Array.from(files.keys()),
		read: async (p: string) => files.get(p)!,
		create: async (p: string, s: string) => {
			if (files.has(p)) throw Error("exists");
			files.set(p, s);
		},
		process: async (p: string, fn: (s: string) => string) => {
			files.set(p, fn(files.get(p)!));
		},
	};
}
const config = {
	outputDirectory: "books",
	propertyNames: names,
	propertyNameHistory: [],
	templateContent: "---\ntags: [books]\n---\n# {{title}}\n\n{{highlights}}\n",
};
describe("persisting Kindle note updates", () => {
	it("updates the existing renamed file with zero new highlights without replacing its body", async () => {
		const source =
			'---\nbookId: "saved"\ntitle: Original\nASIN: ABC\nlastAnnotated: Invalid date\n---\n\n> Edited abc ^ref-19495\n\nMemo\n';
		const io = memoryVault({ "books/Handwritten name.md": source });
		const result = await saveBookNotes(io, config, [book], [highlight]);
		expect(result.updated).toBe(1);
		expect(result.added).toBe(0);
		expect(io.files.size).toBe(1);
		const note = io.files.get("books/Handwritten name.md")!;
		expect(splitNote(note).body).toBe(splitNote(source).body);
		expect(readBookProperties(note, names, [])).toMatchObject({
			bookId: "saved",
			lastAnnotatedDate: "2026-10-08",
		});
	});
	it("creates one compatible note and repeats safely", async () => {
		const io = memoryVault();
		expect(
			(await saveBookNotes(io, config, [book], [highlight])).created,
		).toBe(1);
		expect(
			(await saveBookNotes(io, config, [book], [highlight])).added,
		).toBe(0);
		expect(io.files.size).toBe(1);
		expect(io.files.get("books/Renamed Book.md")).toContain("^ref-19495");
	});
	it("does not overwrite an unrelated same-name note or create a duplicate for conflicting ASINs", async () => {
		const io = memoryVault({
			"books/Renamed Book.md": "My unrelated memo",
		});
		const result = await saveBookNotes(io, config, [book], [highlight]);
		expect(result.failed).toBe(1);
		expect(io.files.get("books/Renamed Book.md")).toBe("My unrelated memo");
	});
	it("never writes malformed matching notes or unchanged bodies with ambiguous highlights", async () => {
		const source =
			"---\nbookId: id\ntitle: B\nASIN: ABC\n---\n> Edited\n> [10](kindle://book?action=open&asin=ABC&location=10)\n";
		const io = memoryVault({ "books/B.md": source });
		const result = await saveBookNotes(io, config, [book], [highlight]);
		expect(result.held).toBe(1);
		expect(io.files.get("books/B.md")).toBe(source);
	});
});

it("blocks writes if an existing note cannot be read for identity matching", async () => {
	const io = memoryVault({ "books/Handwritten name.md": "existing" });
	io.read = async () => {
		throw Error("unreadable");
	};
	const result = await saveBookNotes(io, config, [book], [highlight]);
	expect(result.failed).toBeGreaterThan(0);
	expect(result.created).toBe(0);
	expect(io.files.size).toBe(1);
});

it("reports each ASIN's save outcome separately, including empty new books", async () => {
	const io = memoryVault({
		"books/B.md":
			"---\nASIN: HELD\nbookId: saved\ntitle: Held\n---\n> Hand edited\n> [10](kindle://book?action=open&asin=HELD&location=10)\n",
		"books/Failed.md": "Unrelated memo",
	});
	const result = await saveBookNotes(
		io,
		config,
		[
			book,
			{ id: "HELD", asin: "HELD", title: "Held" },
			{ id: "FAILED", asin: "FAILED", title: "Failed" },
			{ id: "EMPTY", asin: "EMPTY", title: "Empty" },
		],
		[
			highlight,
			{ ...highlight, bookId: "HELD" },
			{ ...highlight, bookId: "FAILED" },
		],
	);
	expect(result.outcomes).toMatchObject([
		{ asin: "ABC", status: "created", path: "books/Renamed Book.md" },
		{ asin: "HELD", status: "held", path: "books/B.md" },
		{ asin: "FAILED", status: "failed" },
		{ asin: "EMPTY", status: "skipped-no-highlights" },
	]);
});

it("retains links, old anchors, personal notes and the renamed path on two consecutive saves", async () => {
	const source =
		'---\nbookId: "saved"\ntitle: Original\nASIN: ABC\n---\n\n> [[Related]] Edited abc ^ref-19495\n\nPersonal memo [[Other]]\n';
	const io = memoryVault({ "books/My renamed book.md": source });
	const highlights = [
		highlight,
		{ id: "new", bookId: "ABC", text: "new highlight", location: "20" },
	];
	const first = await saveBookNotes(io, config, [book], highlights);
	const afterFirst = io.files.get("books/My renamed book.md")!;
	const second = await saveBookNotes(io, config, [book], highlights);
	expect(first.added).toBe(1);
	expect(second.added).toBe(0);
	expect(splitNote(afterFirst).body.startsWith(splitNote(source).body)).toBe(
		true,
	);
	expect(io.files.get("books/My renamed book.md")).toBe(afterFirst);
	expect(Array.from(io.files.keys())).toEqual(["books/My renamed book.md"]);
	expect(readBookProperties(afterFirst)!.bookId).toBe("saved");
	expect(second.outcomes).toMatchObject([
		{ asin: "ABC", status: "updated", path: "books/My renamed book.md" },
	]);
});

describe("book completion notifications", () => {
	it("reports completion only after a pending write settles", async () => {
		const io = memoryVault();
		let release!: () => void;
		io.create = async () =>
			new Promise<void>((r) => {
				release = r;
			});
		const outcomes: string[] = [];
		const saving = saveBookNotes(
			io,
			config,
			[book],
			[highlight],
			undefined,
			(_book, _index, outcome) => outcomes.push(outcome.status),
		);
		await Promise.resolve();
		expect(outcomes).toEqual([]);
		release();
		await saving;
		expect(outcomes).toEqual(["success"]);
	});
	it("settles books with no highlights and failed writes exactly once", async () => {
		const outcomes: string[] = [];
		const io = memoryVault();
		io.create = async () => {
			throw Object.assign(Error("private data"), { code: "ENOSPC" });
		};
		await saveBookNotes(
			io,
			config,
			[book, { ...book, id: "EMPTY", asin: "EMPTY" }],
			[highlight],
			undefined,
			(_book, _index, outcome) =>
				outcomes.push(
					outcome.status + ":" + (outcome.issues[0]?.message ?? ""),
				),
		);
		expect(outcomes).toEqual([
			"failed:Filesystem error: ENOSPC",
			"unchanged:",
		]);
	});
	it("reports held notes and unreadable identity scans without success", async () => {
		const outcomes: string[] = [];
		const io = memoryVault({
			"books/B.md":
				"---\nbookId: id\ntitle: B\nASIN: ABC\n---\n> Edited\n> [10](kindle://book?action=open&asin=ABC&location=10)\n",
		});
		await saveBookNotes(
			io,
			config,
			[book],
			[highlight],
			undefined,
			(_book, _index, outcome) => outcomes.push(outcome.status),
		);
		expect(outcomes).toEqual(["held"]);
		io.read = async () => {
			throw Error("unreadable");
		};
		outcomes.length = 0;
		await saveBookNotes(
			io,
			config,
			[book],
			[highlight],
			undefined,
			(_book, _index, outcome) => outcomes.push(outcome.status),
		);
		expect(outcomes).toEqual(["failed"]);
	});
});

it("retains unreadable note details even with zero fetched books", async () => {
	const io = memoryVault({ "books/B.md": "existing" });
	io.read = async () => {
		throw Error("unreadable");
	};
	const result = await saveBookNotes(io, config, [], []);
	expect(result.issues).toEqual([
		{ phase: "save", path: "books/B.md", message: "Unreadable note" },
	]);
	expect(result.failed).toBe(0);
});


it("reports an identical existing note as unchanged while retaining its successful completion", async () => {
 const io=memoryVault();
 await saveBookNotes(io,config,[book],[highlight]);
 const original=io.files.get("books/Renamed Book.md");
 const outcomes:string[]=[];
 await saveBookNotes(io,config,[book],[highlight],undefined,
  (_book,_index,outcome)=>outcomes.push(outcome.status));
 expect(io.files.get("books/Renamed Book.md")).toBe(original);
 expect(outcomes).toEqual(["unchanged"]);
});


describe("explicit duplicate ASIN destinations", () => {
	const a = "books/Chosen name.md",
		b = "books/Other name.md";
	const source =
		"---\nbookId: saved\ntitle: Edited\nASIN: ABC\ncustom: [keep, me]\n---\n\n> [[Related]] Edited abc ^ref-19495\n\nPersonal memo [[Other]]\n";
	const other = source + "Other personal memo\n";
	function duplicateVault() {
		return {
			...memoryVault({ [a]: source, [b]: other }),
			identity: (path: string): number => (path === a ? 10 : 20),
		};
	}
	const selected = {
		...config,
		noteDestinations: { ABC: { path: a, fileId: "test-file", ctime: 10 } },
	};
	it("holds unselected duplicates with all candidate paths and no completion", async () => {
		const io = duplicateVault(),
			statuses: string[] = [];
		const result = await saveBookNotes(
			io,
			config,
			[book],
			[highlight],
			undefined,
			(_b, _i, o) => statuses.push(o.status),
		);
		expect(result).toMatchObject({
			held: 1,
			failed: 0,
			created: 0,
			updated: 0,
			added: 0,
		});
		expect(result.outcomes).toEqual([
			{
				asin: "ABC",
				status: "held",
				reason: "destination-unselected",
				candidates: [a, b],
			},
		]);
		expect(statuses).toEqual(["held"]);
		expect(
			result.issues?.some((i) => i.message.includes("destination-unselected")),
		).toBe(true);
		expect(Object.fromEntries(io.files)).toEqual({ [a]: source, [b]: other });
	});
	it("resumes after hold, updates only the selected snapshot and is idempotent twice", async () => {
		const io = duplicateVault();
		const hs = [
			highlight,
			{ ...highlight, id: "new", text: "new highlight", location: "20" },
		];
		expect((await saveBookNotes(io, config, [book], hs)).held).toBe(1);
		expect(
			(
				await saveBookNotes(
					io,
					JSON.parse(JSON.stringify(selected)),
					[book],
					hs,
				)
			).added,
		).toBe(1);
		const after = io.files.get(a)!;
		expect(splitNote(after).body.startsWith(splitNote(source).body)).toBe(true);
		expect(
			(
				await saveBookNotes(
					io,
					JSON.parse(JSON.stringify(selected)),
					[book],
					hs,
				)
			).added,
		).toBe(0);
		expect(io.files.get(a)).toBe(after);
		expect(io.files.get(b)).toBe(other);
		expect([...io.files.keys()]).toEqual([a, b]);
	});
	it.each(["missing", "asin-changed", "asin-removed", "replaced", "renamed"])(
		"holds %s targets without falling back to the remaining candidate",
		async (kind) => {
			const io = duplicateVault();
			let reason = "destination-identity-changed";
			if (kind === "missing") {
				io.files.delete(a);
				reason = "destination-missing";
			}
			if (kind === "asin-changed")
				io.files.set(a, source.replace("ASIN: ABC", "ASIN: OTHER"));
			if (kind === "asin-removed")
				io.files.set(a, source.replace("ASIN: ABC\n", ""));
			if (kind === "replaced") io.identity = () => 99;
			const settings = JSON.parse(JSON.stringify(selected));
			if (kind === "renamed") {
				settings.noteDestinations.ABC.invalidated = "renamed";
				reason = "destination-renamed";
			}
			const before = Object.fromEntries(io.files);
			const r = await saveBookNotes(io, settings, [book], [highlight]);
			expect(r).toMatchObject({ held: 1, failed: 0, updated: 0, created: 0 });
			expect(r.outcomes?.[0]).toMatchObject({
				status: "held",
				reason,
				path: a,
			});
			expect(Object.fromEntries(io.files)).toEqual(before);
		},
	);
	it("holds a selected ASIN removed inside atomic process without changing any properties", async () => {
		const io = duplicateVault();
		const original = io.process;
		io.process = async (p, fn) => {
			io.files.set(p, source.replace("ASIN: ABC\n", ""));
			await original(p, fn);
		};
		const r = await saveBookNotes(
			io,
			JSON.parse(JSON.stringify(selected)),
			[book],
			[highlight],
		);
		expect(r).toMatchObject({ held: 1, failed: 0, updated: 0 });
		expect(r.outcomes?.[0].reason).toBe("destination-identity-changed");
		expect(io.files.get(a)).toBe(source.replace("ASIN: ABC\n", ""));
		expect(io.files.get(b)).toBe(other);
	});
	it("holds a selection invalidated after the scan and before process", async () => {
		const io = duplicateVault(),
			settings = JSON.parse(JSON.stringify(selected));
		const original = io.process;
		io.process = async (p, fn) => {
			settings.noteDestinations.ABC.invalidated = "deleted";
			await original(p, fn);
		};
		const r = await saveBookNotes(io, settings, [book], [highlight]);
		expect(r).toMatchObject({ held: 1, failed: 0, updated: 0 });
		expect(Object.fromEntries(io.files)).toEqual({ [a]: source, [b]: other });
	});
});

it.each(["Note unavailable", "Note identity changed during synchronization"])(
	"holds a selected file lost between resolution and atomic process: %s",
	async (message) => {
		const path = "books/A.md",
			source = "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nMemo\n";
		const io = { ...memoryVault({ [path]: source }), identity: () => 10 };
		io.process = async () => {
			throw Error(message);
		};
		const r = await saveBookNotes(
			io,
			{
				...config,
				noteDestinations: { ABC: { path, fileId: "test-file", ctime: 10 } },
			},
			[book],
			[highlight],
		);
		expect(r).toMatchObject({ held: 1, failed: 0, updated: 0 });
		expect(io.files.get(path)).toBe(source);
	},
);
it("holds malformed selected properties inside process", async () => {
	const path = "books/A.md",
		source = "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nMemo\n",
		broken = "---\nASIN: [\n---\nMemo\n";
	const io = { ...memoryVault({ [path]: source }), identity: () => 10 };
	io.process = async (p, fn) => {
		io.files.set(p, broken);
		io.files.set(p, fn(broken));
	};
	const r = await saveBookNotes(
		io,
		{
			...config,
			noteDestinations: { ABC: { path, fileId: "test-file", ctime: 10 } },
		},
		[book],
		[highlight],
	);
	expect(r).toMatchObject({ held: 1, failed: 0, updated: 0 });
	expect(io.files.get(path)).toBe(broken);
});

it.each(["missing", "asin-changed"])(
	"requires reselection after detecting %s even if the old destination returns",
	async (kind) => {
		const a = "books/A.md",
			b = "books/B.md",
			source = "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nMemo\n";
		const io = {
			...memoryVault({ [a]: source, [b]: source }),
			identity: () => 10,
		};
		const cfg = {
			...config,
			noteDestinations: { ABC: { path: a, fileId: "test-file", ctime: 10 } },
		};
		if (kind === "missing") io.files.delete(a);
		else io.files.set(a, source.replace("ASIN: ABC", "ASIN: OTHER"));
		expect((await saveBookNotes(io, cfg, [book], [highlight])).held).toBe(1);
		io.files.set(a, source);
		const loaded = JSON.parse(JSON.stringify(cfg));
		expect((await saveBookNotes(io, loaded, [book], [highlight])).held).toBe(1);
		expect(io.files.get(a)).toBe(source);
		expect(io.files.get(b)).toBe(source);
		const reselected = {
			...config,
			noteDestinations: { ABC: { path: a, fileId: "test-file", ctime: 10 } },
		};
		expect(
			(await saveBookNotes(io, reselected, [book], [highlight])).added,
		).toBe(1);
	},
);

it("updates an explicitly selected ASIN-only note and leaves the complete alternative unchanged", async () => {
	const a = "books/Minimal.md",
		b = "books/Full.md",
		minimal = "---\nASIN: ABC\ncustom: keep\n---\nMy memo [[Link]]\n",
		full = "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nOther memo\n";
	const io = {
		...memoryVault({ [a]: minimal, [b]: full }),
		identity: () => 10,
	};
	expect((await saveBookNotes(io, config, [book], [highlight])).held).toBe(1);
	const cfg = {
		...config,
		noteDestinations: { ABC: { path: a, fileId: "test-file", ctime: 10 } },
	};
	expect((await saveBookNotes(io, cfg, [book], [highlight])).added).toBe(1);
	expect(io.files.get(a)).toContain("My memo [[Link]]");
	expect(io.files.get(b)).toBe(full);
	expect((await saveBookNotes(io, cfg, [book], [highlight])).added).toBe(0);
});

it("holds a selected file that disappears while its snapshot is being read", async () => {
	const path = "books/A.md",
		source = "---\nASIN: ABC\nbookId: saved\ntitle: Book\n---\nMemo\n";
	const io = { ...memoryVault({ [path]: source }), identity: () => 10 };
	io.read = async () => {
		io.files.delete(path);
		throw Error("ENOENT");
	};
	const result = await saveBookNotes(
		io,
		{
			...config,
			noteDestinations: { ABC: { path, fileId: "test-file", ctime: 10 } },
		},
		[book],
		[highlight],
	);
	expect(result).toMatchObject({ held: 1, failed: 0, created: 0 });
	expect(result.outcomes?.[0]).toMatchObject({
		reason: "destination-missing",
		status: "held",
	});
});
