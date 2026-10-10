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
	return {
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
			await app.vault.create(path, content);
		},
		async process(path, fn) {
			if (!isActive()) throw new Error("Plugin unloaded");
			await app.vault.process(fileAt(app, path), fn);
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
