import { t } from "../i18n";
import type { SyncErrorRecord, SyncIssue } from "../services/sync-progress";

export function renderSyncIssues(container: HTMLElement, issues: SyncIssue[]) {
	container.replaceChildren();
	const list = document.createElement("ul");
	list.className = "kindle-sync-issue-list";
	for (const issue of issues) {
		const entry = document.createElement("li");
		const context = document.createElement("div");
		context.className = "kindle-sync-issue-context";
		context.textContent = [
			t(`progress.phases.${issue.phase}`),
			issue.bookTitle,
			issue.path,
		]
			.filter(Boolean)
			.join(" · ");
		const cause = document.createElement("div");
		cause.textContent = issue.message;
		entry.append(context, cause);
		list.append(entry);
	}
	container.append(list);
}
export function renderErrorRecord(
	container: HTMLElement,
	record: SyncErrorRecord | undefined,
	clear: () => Promise<void>,
) {
	container.replaceChildren();
	container.className = "kindle-diagnostics-card";
	const title = document.createElement("h3");
	title.textContent = t("diagnostics.title");
	container.append(title);
	if (!record) {
		const empty = document.createElement("p");
		empty.className = "setting-item-description";
		empty.textContent = t("diagnostics.empty");
		container.append(empty);
		return;
	}
	const meta = document.createElement("p");
	meta.className = "kindle-diagnostics-meta";
	meta.textContent = [
		new Date(record.at).toLocaleString(),
		t(`diagnostics.operations.${record.operation}`),
		t(`progress.status.${record.status}`),
		`Amazon (${record.region})`,
	].join(" · ");
	container.append(meta);
	if (record.counts) {
		const counts = document.createElement("p");
		counts.className = "kindle-diagnostics-counts";
		counts.textContent = t("diagnostics.counts", {
			total: record.counts.total ?? "—",
			completed: record.counts.completed,
			failed: record.counts.failed,
			held: record.counts.held,
		});
		container.append(counts);
	}
	const details = document.createElement("div");
	renderSyncIssues(details, record.issues);
	container.append(details);
	const button = document.createElement("button");
	button.textContent = t("diagnostics.clear");
	button.onclick = async () => {
		button.disabled = true;
		try {
			await clear();
		} finally {
			button.disabled = false;
		}
	};
	container.append(button);
}
