import { App, Modal, setIcon } from "obsidian";
import { t } from "../i18n";
import { SyncPhase, SyncProgressTracker } from "../services/sync-progress";
import { renderSyncIssues } from "../ui/sync-diagnostics";

export class SyncProgressModal extends Modal {
	private statusEl!: HTMLElement;
	private statusIcon!: HTMLElement;
	private bookEl!: HTMLElement;
	private progressEl!: HTMLProgressElement;
	private percentEl!: HTMLElement;
	private countEls = new Map<string, HTMLElement>();
	private steps = new Map<SyncPhase, HTMLElement>();
	private detailsEl!: HTMLDetailsElement;
	private issuesEl!: HTMLElement;
	private readonly onChange = () => this.render();
	constructor(
		app: App,
		private tracker: SyncProgressTracker,
	) {
		super(app);
	}
	onOpen() {
		this.contentEl.empty();
		this.modalEl.addClass("kindle-sync-modal");
		const card = this.contentEl.createDiv({ cls: "kindle-sync-card" });
		const heading = card.createDiv({ cls: "kindle-sync-heading" });
		this.statusIcon = heading.createDiv({ cls: "kindle-sync-state-icon" });
		this.statusIcon.setAttribute("aria-hidden", "true");
		this.statusEl = heading.createDiv({ cls: "kindle-sync-status" });
		this.statusEl.setAttribute("role", "status");
		const stages = card.createEl("ol", { cls: "kindle-sync-stages" });
		this.steps.clear();
		const phases: SyncPhase[] = this.tracker.state.metadataEnabled
			? ["auth", "fetch", "metadata", "save"]
			: ["auth", "fetch", "save"];
		for (const phase of phases) {
			const step = stages.createEl("li", {
				text: t(`progress.phases.${phase}`),
			});
			this.steps.set(phase, step);
		}
		this.bookEl = card.createDiv({ cls: "kindle-sync-current-book" });
		this.bookEl.setAttribute("aria-live", "polite");
		const progressRow = card.createDiv({ cls: "kindle-sync-progress-row" });
		this.progressEl = progressRow.createEl("progress", {
			cls: "kindle-sync-progress",
		});
		this.progressEl.max = 100;
		this.percentEl = progressRow.createEl("span", {
			cls: "kindle-sync-percent",
		});
		const metrics = card.createDiv({ cls: "kindle-sync-counts" });
		this.countEls.clear();
		for (const key of ["total", "completed", "failed", "held"]) {
			const metric = metrics.createDiv({ cls: "kindle-sync-count" });
			metric.createEl("span", { text: t(`progress.counts.${key}`) });
			const value = metric.createEl("strong");
			value.setAttribute("data-count", key);
			this.countEls.set(key, value);
		}
		this.detailsEl = card.createEl("details", {
			cls: "kindle-sync-errors",
		});
		this.detailsEl.createEl("summary", { text: t("diagnostics.details") });
		this.issuesEl = this.detailsEl.createDiv();
		const buttons = this.contentEl.createDiv({
			cls: "modal-button-container",
		});
		buttons.createEl("button", { text: t("progress.close") }).onclick =
			() => this.close();
		buttons.createEl("p", {
			text: t("progress.closeHint"),
			cls: "kindle-sync-close-hint",
		});
		this.tracker.on("change", this.onChange);
		this.render();
	}
	private render() {
		const state = this.tracker.state;
		const running = state.status === "running";
		const phase = state.phase === "session" ? "save" : state.phase;
		this.titleEl.setText(
			t(running ? "progress.title" : `progress.status.${state.status}`),
		);
		this.statusEl.setText(
			t(
				running
					? `progress.phases.${state.phase}`
					: `progress.status.${state.status}`,
			),
		);
		this.statusIcon.className = `kindle-sync-state-icon is-${state.status}`;
		setIcon(
			this.statusIcon,
			running
				? "loader-circle"
				: state.status === "completed"
					? "circle-check"
					: "circle-alert",
		);
		const phaseIndex = [...this.steps.keys()].indexOf(phase);
		[...this.steps.entries()].forEach(([stepPhase, el], index) => {
			el.className =
				index < phaseIndex || state.status === "completed"
					? "is-done"
					: index === phaseIndex
						? "is-active"
						: "";
			if (running && stepPhase === phase)
				el.setAttribute("aria-current", "step");
			else el.removeAttribute("aria-current");
		});
		this.bookEl.setText(
			state.currentBook
				? t("progress.currentBook", { title: state.currentBook })
				: t(running ? "progress.waiting" : "progress.finishedBooks"),
		);
		const { total, completed, failed, held } = state.counts;
		const processed = completed + failed + held;
		if (total === null) {
			this.progressEl.removeAttribute("value");
			this.percentEl.setText(t("progress.unknownTotal"));
		} else {
			const percent =
				total === 0
					? running
						? 0
						: 100
					: Math.min(100, Math.round((processed / total) * 100));
			this.progressEl.value = percent;
			this.percentEl.setText(`${percent}%`);
		}
		this.progressEl.setAttribute(
			"aria-label",
			t("progress.barLabel", {
				phase: t(`progress.phases.${state.phase}`),
			}),
		);
		this.countEls
			.get("total")!
			.setText(total === null ? "—" : String(total));
		this.countEls.get("completed")!.setText(String(completed));
		this.countEls.get("failed")!.setText(String(failed));
		this.countEls.get("held")!.setText(String(held));
		this.detailsEl.hidden = !state.issues.length;
		renderSyncIssues(this.issuesEl, state.issues);
		if (!running && state.issues.length) this.detailsEl.open = true;
		const hint = this.contentEl.querySelector<HTMLElement>(
			".kindle-sync-close-hint",
		);
		if (hint) hint.hidden = !running;
	}
	onClose() {
		this.tracker.off("change", this.onChange);
		this.contentEl.empty();
	}
}
