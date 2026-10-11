import { t } from "../i18n";
import type { SyncActivityEntry } from "../services/sync-progress";

export function formatActivityDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
export interface ActivityPart { text: string; book: boolean }
export function activityParts(entry: SyncActivityEntry): ActivityPart[] {
	const marker = "\u0000book\u0000";
	let title: string | undefined;
	let message: string;
	switch (entry.kind) {
		case "phase":
			message = t("progress.activity.phase", {
				phase: t(`progress.phases.${entry.phase}`),
				total: entry.total === null ? t("progress.unknownTotal") : t("progress.activity.total", { total: entry.total }),
			});
			break;
		case "book-start":
		case "book-end":
			title = entry.bookTitle;
			message = t(`progress.activity.${entry.kind === "book-start" ? "bookStart" : "bookEnd"}`, {
				phase: t(`progress.phases.${entry.phase}`),
				title: title === undefined ? t("progress.activity.unnamed") : marker,
				...(entry.kind === "book-end" ? { outcome: t(`progress.activity.outcomes.${entry.outcome === "success" ? entry.phase : entry.outcome}`) } : {}),
			});
			break;
		case "issue":
			title = entry.issue.bookTitle;
			message = t("progress.activity.issue", {
				phase: t(`progress.phases.${entry.issue.phase}`),
				title: title === undefined ? entry.issue.path ?? t("progress.activity.unnamed") : marker,
				message: entry.issue.message,
			});
			if (title !== undefined && entry.issue.path) message += ` (${entry.issue.path})`;
			break;
		case "result":
			message = t("progress.activity.result", {
				status: t(`progress.status.${entry.status}`),
				completed: entry.counts.completed,
				total: entry.counts.total ?? "—",
				failed: entry.counts.failed,
				held: entry.counts.held,
			});
	}
	return message.split(marker).flatMap((text, index) => [
		...(index > 0 ? [{ text: title ?? "", book: true }] : []),
		{ text, book: false },
	]);
}
export function formatActivityLog(entries: SyncActivityEntry[]): string {
	return entries.map(entry => {
		const delta = entry.deltaMs === undefined ? "" : `+${formatActivityDuration(entry.deltaMs)}`;
		return `${new Date(entry.at).toISOString()} ${delta}\t${activityParts(entry).map(part => part.text).join("")}`;
	}).join("\n");
}
