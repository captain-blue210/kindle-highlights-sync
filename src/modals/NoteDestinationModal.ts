import { App, Modal } from "obsidian";
import { t } from "../i18n";
import type { DestinationGroup } from "../services/note-destination";
import type { NoteSnapshot } from "../services/note-sync";

export class NoteDestinationModal extends Modal {
	constructor(
		app: App,
		private groups: DestinationGroup[],
		private save: (asin: string, note: NoteSnapshot) => Promise<void>,
	) {
		super(app);
	}
	onOpen() {
		this.titleEl.setText(t("destinations.title"));
		const el = this.contentEl;
		el.empty();
		el.createEl("p", { text: t("destinations.description") });
		if (!this.groups.length)
			el.createEl("p", { text: t("destinations.empty") });
		for (const group of this.groups) {
			const row = el.createDiv({ cls: "kindle-destination-group" });
			row.createEl("h3", { text: group.asin });
			if (group.selected)
				row.createEl("p", {
					text: t("destinations.selected", {
						path: group.selected.path,
					}),
				});
			if (group.selected?.invalidated)
				row.createEl("p", {
					text: t("destinations.reselect"),
					cls: "mod-warning",
				});
			const list = row.createEl("ul");
			for (const note of group.candidates)
				list.createEl("li", { text: note.path });
			const label = row.createEl("label", {
				text: t("destinations.choose"),
			});
			const select = label.createEl("select");
			select.createEl("option", {
				text: t("destinations.unselected"),
				attr: { value: "" },
			});
			for (const note of group.candidates)
				select.createEl("option", {
					text: note.path,
					attr: { value: note.path },
				});
			// Never preselect a candidate, including when only one remains.
			select.value = "";
			const status = row.createEl("p", { attr: { role: "status" } });
			const button = row.createEl("button", {
				text: t("destinations.save"),
			});
			button.disabled = true;
			select.onchange = () => {
				button.disabled = !select.value;
				status.setText("");
			};
			button.onclick = async () => {
				const note = group.candidates.find(
					(n) => n.path === select.value,
				);
				if (!note) return;
				button.disabled = true;
				select.disabled = true;
				status.setText("");
				try {
					await this.save(group.asin, note);
					status.setText(t("destinations.saved"));
				} catch {
					status.setText(t("destinations.failed"));
				} finally {
					button.disabled = !select.value;
					select.disabled = false;
				}
			};
		}
		el.createEl("button", { text: t("progress.close") }).onclick = () =>
			this.close();
	}
	onClose() {
		this.contentEl.empty();
	}
}
