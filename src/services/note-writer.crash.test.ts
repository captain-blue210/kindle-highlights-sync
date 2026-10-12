import { fork } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { DEFAULT_PROPERTY_NAMES } from "./note-properties";
import { saveBookNotes, NoteWriterIO } from "./note-writer";
import { splitNote } from "./note-properties";
import { annotationAnchor, annotationKey } from "./annotation-identity";

// Killing the worker at the storage boundary exercises missing cleanup/result
// notification, unlike throwing an exception inside the same JavaScript process.
let root: string;
const selected = "books/Selected.md",
	other = "books/Other.md";
const book = { id: "ABC", asin: "ABC", title: "Book" };
const highlights = [
	{
		id: "remote-1",
		sourceAnnotationId: "synthetic-amazon-1",
		bookId: "ABC",
		text: "New annotation",
		location: "20",
	},
];
const initial =
	"---\nbookId: saved\ntitle: Book\nASIN: ABC\ncustom: [keep, me]\n---\nPersonal memo [[Related]]\n";
const fileIdentity = (base: string, path: string) => {
	const stat = statSync(join(base, path), { bigint: true });
	return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
};
beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), "kindle-crash-validation-"));
	const bundled = await build({
		entryPoints: [
			fileURLToPath(new URL("./note-writer.ts", import.meta.url)),
		],
		bundle: true,
		platform: "node",
		format: "cjs",
		target: "node18",
		write: false,
		logLevel: "silent",
	});
	writeFileSync(join(root, "writer.cjs"), bundled.outputFiles[0].text);
	writeFileSync(
		join(root, "worker.cjs"),
		`
 const fs=require('node:fs'),path=require('node:path');
 const {saveBookNotes}=require(${JSON.stringify(join(root, "writer.cjs"))});
 const base=process.argv[2],phase=process.argv[3];
 const fixture=JSON.parse(fs.readFileSync(path.join(base,'fixture.json'),'utf8'));
 const io={
  list:()=>['${selected}','${other}'],
  read:async p=>fs.readFileSync(path.join(base,p),'utf8'),
  identity:p=>fs.statSync(path.join(base,p)).birthtimeMs,
  fileIdentity:p=>{const s=fs.statSync(path.join(base,p),{bigint:true});return [s.dev,s.ino,s.birthtimeNs].join(':');},
  create:async()=>{throw Error('Unexpected create');},
  process:async(p,fn)=>{
   const merged=fn(fs.readFileSync(path.join(base,p),'utf8'));
   if(phase==='after-write')fs.writeFileSync(path.join(base,p),merged);
   process.send({boundary:phase});
   await new Promise(()=>{});
  }
 };
 saveBookNotes(io,fixture.settings,fixture.books,fixture.highlights).then(result=>{process.send({unexpectedResult:result});process.exit(1);},e=>{process.send({unexpectedError:e.message});process.exit(1);});
 `,
	);
});
afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});
function assertSavedAnnotation(content: string) {
	expect(content.match(/^> New annotation$/gm)).toHaveLength(1);
	const anchor = annotationAnchor(highlights[0], book.asin);
	expect(content.match(new RegExp(`^\\^${anchor}$`, "gm"))).toHaveLength(1);
	const markers = [
		...content.matchAll(/<!-- kindle-sync:v1 ([A-Za-z0-9+/=]+) -->/g),
	];
	expect(markers).toHaveLength(1);
	const ledger = JSON.parse(
		Buffer.from(markers[0][1], "base64").toString("utf8"),
	);
	expect(ledger).toEqual({
		version: 1,
		asin: book.asin,
		entries: { [annotationKey(highlights[0], book.asin)]: { anchor } },
	});
}

it.each(["before-write", "after-write"])(
	"replays without omission or duplication after SIGKILL %s",
	async (phase) => {
		const base = join(root, phase);
		mkdirSync(join(base, "books"), { recursive: true });
		writeFileSync(join(base, selected), initial);
		writeFileSync(
			join(base, other),
			initial + "Unselected personal memo\n",
		);
		const untouched = readFileSync(join(base, other));
		const ctime = statSync(join(base, selected)).birthtimeMs;
		const fileId = fileIdentity(base, selected);
		const settings = {
			outputDirectory: "books",
			templateContent: "{{highlights}}",
			propertyNames: DEFAULT_PROPERTY_NAMES,
			propertyNameHistory: [],
			noteDestinations: { ABC: { path: selected, ctime, fileId } },
		};
		writeFileSync(
			join(base, "fixture.json"),
			JSON.stringify({ settings, books: [book], highlights }),
		);
		const child = fork(join(root, "worker.cjs"), [base, phase], {
			stdio: ["ignore", "ignore", "pipe", "ipc"],
			execArgv: [],
		});
		const killed = await new Promise<string | null>((resolve, reject) => {
			let boundary = false;
			let failure: Error | undefined;
			const timeout = setTimeout(() => {
				failure = Error("Worker did not reach storage boundary");
				child.kill("SIGKILL");
			}, 10000);
			child.once("error", (e) => {
				clearTimeout(timeout);
				reject(e);
			});
			child.on("message", (message: any) => {
				if (message.boundary === phase) {
					boundary = true;
					child.kill("SIGKILL");
				} else {
					failure = Error(JSON.stringify(message));
					child.kill("SIGKILL");
				}
			});
			child.once("exit", (_code, signal) => {
				clearTimeout(timeout);
				if (failure) reject(failure);
				else if (!boundary)
					reject(Error("Worker exited before storage boundary"));
				else resolve(signal);
			});
		});
		expect(killed).toBe("SIGKILL");
		expect(readFileSync(join(base, other))).toEqual(untouched);
		if (phase === "before-write")
			expect(readFileSync(join(base, selected), "utf8")).toBe(initial);
		else assertSavedAnnotation(readFileSync(join(base, selected), "utf8"));
		const io: NoteWriterIO = {
			list: () => [selected, other],
			read: async (p) => readFileSync(join(base, p), "utf8"),
			identity: (p) => statSync(join(base, p)).birthtimeMs,
			fileIdentity: (p) => fileIdentity(base, p),
			create: async () => {
				throw Error("Unexpected create");
			},
			process: async (p, fn) => {
				writeFileSync(
					join(base, p),
					fn(readFileSync(join(base, p), "utf8")),
				);
			},
		};
		const resumed = await saveBookNotes(io, settings, [book], highlights);
		expect(resumed).toMatchObject({
			updated: 1,
			failed: 0,
			held: 0,
			added: phase === "before-write" ? 1 : 0,
		});
		const after = readFileSync(join(base, selected), "utf8");
		assertSavedAnnotation(after);
		expect(splitNote(after).body.startsWith(splitNote(initial).body)).toBe(
			true,
		);
		expect(
			await saveBookNotes(io, settings, [book], highlights),
		).toMatchObject({ added: 0, held: 0, failed: 0, updated: 1 });
		expect(readFileSync(join(base, selected), "utf8")).toBe(after);
		expect(readFileSync(join(base, other))).toEqual(untouched);
	},
	15000,
);
