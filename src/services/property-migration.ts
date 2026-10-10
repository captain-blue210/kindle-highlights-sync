import {
	migrateProperties,
	PropertyNames,
	PropertyMigration,
} from "./note-properties";

export interface MigrationIO {
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	// An Obsidian adapter can use vault.process for a final atomic content check.
	replaceIfUnchanged?(
		path: string,
		before: string,
		after: string,
	): Promise<boolean>;
}
export interface MigrationEntry extends PropertyMigration {
	path: string;
	original: string;
}
export interface MigrationPreview {
	entries: MigrationEntry[];
	changed: number;
	skipped: number;
	failed: number;
	errors: string[];
}
export async function previewMigration(
	paths: string[],
	io: MigrationIO,
	names: PropertyNames,
	history: PropertyNames[],
): Promise<MigrationPreview> {
	const result: MigrationPreview = {
		entries: [],
		changed: 0,
		skipped: 0,
		failed: 0,
		errors: [],
	};
	for (const path of paths) {
		try {
			const original = await io.read(path);
			const migration = migrateProperties(original, names, history);
			result.entries.push({ ...migration, path, original });
			if (migration.changed) result.changed++;
			else result.skipped++;
		} catch {
			result.failed++;
			result.errors.push(`${path}: invalid or unreadable frontmatter`);
		}
	}
	return result;
}
export async function runMigration(
	preview: MigrationPreview,
	io: MigrationIO,
	backupDirectory: string,
) {
	const result = {
		migrated: 0,
		skipped: preview.skipped,
		failed: preview.failed,
		conflicts: preview.entries.reduce(
			(sum, e) => sum + e.conflicts.length,
			0,
		),
		errors: [...preview.errors],
		backupDirectory,
	};
	const entries = preview.entries.filter((e) => e.changed);
	for (const e of entries) {
		if (/^(?:\/|\.\.\/)/.test(e.path) || e.path.split("/").includes(".."))
			throw new Error("Unsafe migration path");
		const backup = `${backupDirectory}/${e.path}`;
		if (await io.exists(backup))
			throw new Error(
				"Backup already exists; choose a new backup directory",
			);
		await io.write(backup, e.original);
		if ((await io.read(backup)) !== e.original)
			throw new Error("Backup verification failed");
	}
	for (const e of entries) {
		try {
			const replaced = io.replaceIfUnchanged
				? await io.replaceIfUnchanged(e.path, e.original, e.content)
				: await (async () => {
						if ((await io.read(e.path)) !== e.original)
							return false;
						await io.write(e.path, e.content);
						return true;
					})();
			if (!replaced) throw new Error("Note changed since preview");
			result.migrated++;
		} catch {
			result.failed++;
			result.errors.push(
				`${e.path}: write failed or note changed since preview`,
			);
		}
	}
	return result;
}
