import { statSync } from "fs";
import { join } from "path";
import { App, TFile } from "obsidian";
import type { MigrationIO } from "./property-migration";
import type { NoteWriterIO } from "./note-writer";

export async function ensureFolder(app: App, path: string): Promise<void> {
	let current = "";
	for (const part of path.split("/").filter(Boolean)) {
		if (part === ".." || part === ".")
			throw new Error("Unsafe folder path");
		current = current ? current + "/" + part : part;
		if (!(await app.vault.adapter.exists(current)))
			await app.vault.adapter.mkdir(current);
	}
}
function fileAt(app: App, path: string): TFile {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new Error("Note unavailable");
	return file;
}
export function createVaultIO(
	app: App,
	isActive: () => boolean = () => true,
): MigrationIO & NoteWriterIO {
	// Pin the scanned file objects so a delete/rename + path reuse cannot redirect a write.
	const files = new Map(
		app.vault.getMarkdownFiles().map((file) => [file.path, file]),
	);
	const pinnedFile = (path: string) => {
		const current = fileAt(app, path);
		const scanned = files.get(path);
		if (scanned && (scanned !== current || scanned.path !== path))
			throw new Error("Note identity changed during synchronization");
		return current;
	};
	return {
		fileIdentity: (path) => {
			try {
				pinnedFile(path);
				const adapter = app.vault
					.adapter as typeof app.vault.adapter & {
					getBasePath?: () => string;
				};
				const base = adapter.getBasePath?.();
				if (!base) return undefined;
				const stat = statSync(join(base, path), { bigint: true });
				if (!stat.isFile() || stat.ino.toString() === "0")
					return undefined;
				return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
			} catch {
				return undefined;
			}
		},
		identity: (path) => {
			try {
				return pinnedFile(path).stat.ctime;
			} catch {
				return undefined;
			}
		},
		list: () => app.vault.getMarkdownFiles().map((f) => f.path),
		read: (path) => app.vault.adapter.read(path),
		exists: (path) => app.vault.adapter.exists(path),
		async write(path, content) {
			await ensureFolder(app, path.slice(0, path.lastIndexOf("/")));
			await app.vault.adapter.write(path, content);
		},
		async create(path, content) {
			if (!isActive()) throw new Error("Plugin unloaded");
			await ensureFolder(
				app,
				path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
			);
			const file = await app.vault.create(path, content);
			files.set(path, file);
		},
		async process(path, fn) {
			if (!isActive()) throw new Error("Plugin unloaded");
			await app.vault.process(pinnedFile(path), (content) => {
				pinnedFile(path);
				return fn(content);
			});
		},
		async replaceIfUnchanged(path, before, after) {
			let replaced = false;
			await app.vault.process(fileAt(app, path), (current) => {
				if (current !== before) return current;
				replaced = true;
				return after;
			});
			return replaced;
		},
	};
}
