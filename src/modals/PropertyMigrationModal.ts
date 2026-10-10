import { App, Modal } from "obsidian";
import { t } from "../i18n";
import { MigrationPreview, runMigration } from "../services/property-migration";

type Result = Awaited<ReturnType<typeof runMigration>>;
export class PropertyMigrationModal extends Modal {
	constructor(
		app: App,
		private preview: MigrationPreview,
		private apply: (preview: MigrationPreview) => Promise<Result>,
	) {
		super(app);
	}
	onOpen() {
		this.titleEl.setText(t("migration.title"));
		const el = this.contentEl;
		el.empty();
		el.createEl("p", {
			text: t("migration.previewSummary", {
				changed: this.preview.changed,
				skipped: this.preview.skipped,
				failed: this.preview.failed,
			}),
		});
		el.createEl("p", { text: t("migration.description") });
		const list = el.createDiv({ cls: "kindle-migration-preview" });
		for (const entry of this.preview.entries.filter(
			(e) => e.changed || e.conflicts.length,
		)) {
			const details = list.createEl("details");
			details.createEl("summary", { text: entry.path });
			details.createEl("pre", { text: entry.changes.join("\n") });
			for (const c of entry.conflicts)
				details.createEl("p", {
					text: t("migration.conflict", {
						field: c.field,
						kept: JSON.stringify(c.kept),
						source: JSON.stringify(c.source),
					}),
				});
		}
		for (const error of this.preview.errors)
			list.createEl("p", { text: error, cls: "mod-warning" });
		const buttons = el.createDiv({ cls: "modal-button-container" });
		const apply = buttons.createEl("button", {
			text: t("migration.apply"),
			cls: "mod-cta",
		});
		apply.disabled = !this.preview.changed;
		const cancel = buttons.createEl("button", {
			text: t("migration.cancel"),
		});
		cancel.onclick = () => this.close();
		apply.onclick = async () => {
			apply.disabled = true;
			cancel.disabled = true;
			try {
				const result = await this.apply(this.preview);
				el.empty();
				el.createEl("p", {
					text: t("migration.result", {
						migrated: result.migrated,
						skipped: result.skipped,
						failed: result.failed,
						conflicts: result.conflicts,
					}),
				});
				el.createEl("p", {
					text: t("migration.backup", {
						directory: result.backupDirectory,
					}),
				});
				for (const error of result.errors)
					el.createEl("p", { text: error, cls: "mod-warning" });
			} catch {
				el.empty();
				el.createEl("p", {
					text: t("migration.failed"),
					cls: "mod-warning",
				});
			}
			el.createEl("button", { text: t("migration.close") }).onclick =
				() => this.close();
		};
	}
	onClose() {
		this.contentEl.empty();
	}
}
