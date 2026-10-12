import { App, Modal, setIcon } from "obsidian";
import { t } from "../i18n";
import { SyncProgressTracker } from "../services/sync-progress";
import {
	activityParts,
	formatActivityDuration,
	formatActivityLog,
} from "../ui/sync-activity";
import { renderSyncIssues } from "../ui/sync-diagnostics";

export class SyncProgressModal extends Modal {
	private statusEl!: HTMLElement;
	private statusIcon!: HTMLElement;
	private bookEl!: HTMLElement;
	private resultEl!: HTMLElement;
	private durationEl!: HTMLElement;
	private progressEl!: HTMLProgressElement;
	private countEl!: HTMLElement;
	private annotationsEl!: HTMLElement;
	private secondaryEl!: HTMLElement;
	private detailsEl!: HTMLDetailsElement;
	private issuesEl!: HTMLElement;
	private logEl!: HTMLElement;
	private copyButton!: HTMLButtonElement;
	private copyStatus!: HTMLElement;
	private hintEl!: HTMLElement;
	private lastLogId = 0;
	private lastScrollTop = 0;
	private scrollRemainder = 0;
	private renderedStatus = "";
	private openGeneration = 0;
	private readonly onChange = () => this.render();
	constructor(
		app: App,
		private tracker: SyncProgressTracker,
	) {
		super(app);
	}
	onOpen() {
		this.openGeneration++;
		this.contentEl.empty();
		this.modalEl.addClass("kindle-sync-modal");
		this.lastLogId = 0;
		this.lastScrollTop = 0;
		this.scrollRemainder = 0;
		this.renderedStatus = "";
		const content = this.contentEl.createDiv({
			cls: "kindle-sync-content",
		});
		this.statusIcon = content.createDiv({ cls: "kindle-sync-state-icon" });
		this.statusIcon.setAttribute("aria-hidden", "true");
		this.statusEl = content.createDiv({ cls: "kindle-sync-status" });
		this.statusEl.setAttribute("role", "status");
		this.bookEl = content.createDiv({ cls: "kindle-sync-current-book" });
		this.bookEl.setAttribute("aria-live", "polite");
		this.resultEl = content.createDiv({ cls: "kindle-sync-result-count" });
		const progressRow = content.createDiv({
			cls: "kindle-sync-progress-row",
		});
		this.progressEl = progressRow.createEl("progress", {
			cls: "kindle-sync-progress",
		});
		this.progressEl.max = 100;
		this.countEl = progressRow.createEl("span", {
			cls: "kindle-sync-count-label",
		});
		this.secondaryEl = content.createDiv({
			cls: "kindle-sync-secondary-counts",
		});
		this.annotationsEl = content.createDiv({
			cls: "kindle-sync-annotation-counts",
		});
		this.durationEl = content.createDiv({ cls: "kindle-sync-duration" });
		const log = this.contentEl.createDiv({ cls: "kindle-sync-log" });
		const header = log.createDiv({ cls: "kindle-sync-log-header" });
		header.createEl("span", { text: t("progress.activity.title") });
		const copyControls = header.createDiv({
			cls: "kindle-sync-copy-controls",
		});
		this.copyStatus = copyControls.createEl("span", {
			cls: "kindle-sync-copy-status",
		});
		this.copyStatus.setAttribute("role", "status");
		this.copyButton = copyControls.createEl("button", {
			text: t("progress.activity.copy"),
			cls: "kindle-sync-copy-log",
		});
		this.copyButton.onclick = () => void this.copyLog();
		this.logEl = log.createDiv({ cls: "kindle-sync-log-body" });
		this.logEl.tabIndex = 0;
		this.logEl.setAttribute("role", "region");
		this.logEl.setAttribute("aria-label", t("progress.activity.title"));
		this.detailsEl = this.contentEl.createEl("details", {
			cls: "kindle-sync-errors",
		});
		this.detailsEl.createEl("summary", { text: t("diagnostics.details") });
		this.issuesEl = this.detailsEl.createDiv();
		const buttons = this.contentEl.createDiv({
			cls: "modal-button-container",
		});
		buttons.createEl("button", { text: t("progress.close") }).onclick =
			() => this.close();
		this.hintEl = buttons.createEl("p", {
			text: t("progress.closeHint"),
			cls: "kindle-sync-close-hint",
		});
		this.tracker.on("change", this.onChange);
		this.render();
	}
	private renderCounts(
		el: HTMLElement,
		key: string,
		values: Record<string, string | number>,
	) {
		const markers = Object.fromEntries(
			Object.keys(values).map((key) => [key, `\u0000${key}\u0000`]),
		);
		const text = t(key, markers);
		el.replaceChildren();
		for (const part of text.split(/(\u0000[^\u0000]+\u0000)/g)) {
			const name = part.startsWith("\u0000")
				? part.slice(1, -1)
				: undefined;
			if (name && name in values)
				el.createEl("span", {
					text: String(values[name]),
					attr: { "data-count": name },
				});
			else el.append(document.createTextNode(part));
		}
	}
	private render() {
		const state = this.tracker.state;
		const running = state.status === "running";
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
		if (this.renderedStatus !== state.status) {
			this.renderedStatus = state.status;
			this.statusIcon.className = `kindle-sync-state-icon is-${state.status}`;
			this.statusIcon.replaceChildren();
			if (running) {
				for (let i = 0; i < 3; i++)
					this.statusIcon.createEl("span", {
						cls: "kindle-sync-dot",
					});
			} else
				setIcon(
					this.statusIcon,
					state.status === "completed"
						? "check"
						: state.status === "interrupted"
							? "circle-pause"
							: "circle-alert",
				);
		}
		this.bookEl.hidden = !running || !state.currentBook;
		this.bookEl.replaceChildren();
		if (running) {
			if (state.currentBook) {
				this.bookEl.append(
					document.createTextNode(t("progress.bookPrefix")),
				);
				this.bookEl.createEl("strong", { text: state.currentBook });
			} else this.bookEl.setText(t(`progress.phases.${state.phase}`));
		}
		this.resultEl.hidden = running;
		if (!running) {
			this.resultEl.replaceChildren();
			this.resultEl.createEl("strong", {
				text: String(state.counts.completed),
			});
			this.resultEl.createEl("span", {
				text: t("progress.booksCompleted"),
			});
		}
		const { total, completed, failed, held } = state.counts;
		if (total === null) {
			this.progressEl.removeAttribute("value");
			this.countEl.setText(t("progress.unknownTotal"));
		} else {
			this.progressEl.value =
				total === 0
					? running
						? 0
						: 100
					: Math.min(
							100,
							Math.round(
								((completed + failed + held) / total) * 100,
							),
						);
			this.renderCounts(this.countEl, "progress.countSummary", {
				completed,
				total,
			});
		}
		this.progressEl.setAttribute(
			"aria-label",
			t("progress.barLabel", {
				phase: t(`progress.phases.${state.phase}`),
			}),
		);
		this.renderCounts(this.secondaryEl, "progress.secondaryCounts", {
			failed,
			held,
		});
		const annotationText = t("progress.annotationsFetched", {
			...state.annotations.fetched,
		});
		this.annotationsEl.setText(
			annotationText +
				(running
					? ""
					: "\n" +
						t("progress.annotationsAdded", {
							...state.annotations.added,
						})),
		);
		this.durationEl.hidden = running;
		if (!running && state.endedAt !== null)
			this.durationEl.setText(
				t("progress.duration", {
					duration: formatActivityDuration(
						Math.max(0, state.endedAt - state.startedAt),
					),
				}),
			);
		this.renderLog();
		this.detailsEl.hidden = !state.issues.length;
		renderSyncIssues(this.issuesEl, state.issues);
		if (!running && state.issues.length) this.detailsEl.open = true;
		this.hintEl.hidden = !running;
	}
	private renderLog() {
		const entries = this.tracker.state.activityLog;
		const latest = entries[entries.length - 1]?.id ?? 0;
		if (latest === this.lastLogId) return;
		const firstRender = this.lastLogId === 0;
		const atBottom = this.logEl.scrollHeight - this.logEl.clientHeight - this.logEl.scrollTop <= 4;
		const previousScroll = this.logEl.scrollTop;
		if (previousScroll !== this.lastScrollTop) this.scrollRemainder = 0;
		const retainedIds = new Set(entries.map((entry) => String(entry.id)));
		let removedHeight = 0;
		for (const child of Array.from(this.logEl.children)) {
			const row = child as HTMLElement;
			if (!retainedIds.has(row.dataset.logId ?? "")) {
				removedHeight += row.getBoundingClientRect().height;
				row.remove();
			}
		}
		for (const entry of entries) {
			if (entry.id <= this.lastLogId) continue;
			const row = this.logEl.createDiv({
				cls: `kindle-sync-log-line${entry.kind === "issue" || (entry.kind === "book-end" && (entry.outcome === "failed" || entry.outcome === "held")) ? " is-warning" : ""}`,
			});
			row.dataset.logId = String(entry.id);
			const message = row.createEl("span", {
				cls: "kindle-sync-log-text",
			});
			for (const part of activityParts(entry))
				message.createEl(part.book ? "strong" : "span", {
					text: part.text,
					cls: part.book ? "kindle-sync-log-book" : "",
				});
			row.createEl("span", {
				text:
					entry.deltaMs === undefined
						? ""
						: `+${formatActivityDuration(entry.deltaMs)}`,
				cls: "kindle-sync-log-delta",
			});
		}
		this.lastLogId = latest;
		const target =
			firstRender || atBottom
				? Math.max(0, this.logEl.scrollHeight - this.logEl.clientHeight)
				: Math.max(
						0,
						previousScroll + this.scrollRemainder - removedHeight,
					);
		this.logEl.scrollTop = target;
		this.lastScrollTop = this.logEl.scrollTop;
		// Chromium rounds applied offsets to device pixels; carry the remainder across evictions.
		this.scrollRemainder = firstRender || atBottom ? 0 : target - this.lastScrollTop;
	}
	private async copyLog() {
		const generation = this.openGeneration;
		this.copyButton.disabled = true;
		this.copyStatus.setText("");
		try {
			await navigator.clipboard.writeText(
				formatActivityLog(this.tracker.state.activityLog),
			);
			if (generation === this.openGeneration)
				this.copyStatus.setText(t("progress.activity.copied"));
		} catch {
			if (generation === this.openGeneration) this.copyStatus.setText(t("progress.activity.copyFailed"));
		} finally {
			if (generation === this.openGeneration) this.copyButton.disabled = false;
		}
	}
	onClose() {
		this.openGeneration++;
		this.tracker.off("change", this.onChange);
		this.contentEl.empty();
	}
}
