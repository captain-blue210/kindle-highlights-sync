import { EventEmitter } from "events";

export type SyncPhase = "auth" | "fetch" | "metadata" | "save" | "session";
export type BookStatus = "success" | "unchanged" | "failed" | "held";
export interface BookCounts {
	total: number | null;
	completed: number;
	failed: number;
	held: number;
}
export interface SyncIssue {
	phase: SyncPhase;
	message: string;
	bookTitle?: string;
	path?: string;
}
export interface SyncErrorRecord {
	at: string;
	operation: "sync" | "login" | "logout";
	region: string;
	status: "partial" | "failed" | "interrupted";
	counts?: BookCounts;
	issues: SyncIssue[];
}
export interface SyncProgressState {
	phase: SyncPhase;
	status: "running" | "completed" | "partial" | "failed" | "interrupted";
	counts: BookCounts;
	currentBook: string | null;
	issues: SyncIssue[];
	metadataEnabled: boolean;
}

// Only recognized application reasons and system codes cross the diagnostics boundary.
// Raw Electron/Keychain/renderer exceptions may contain cookies, URLs or response bodies.
const reasons = new Set([
	"Multiple notes have the same ASIN",
	"Multiple notes have the same book ID",
	"Note identity changed during synchronization",
	"Existing note cannot be safely identified",
	"An unrelated note already uses this filename",
	"Invalid output directory",
	"Unclosed YAML frontmatter",
	"Invalid YAML frontmatter",
	"Invalid Kindle book ID",
	"Highlight ID collision; note left unchanged",
	"Unanchored quote has no location; note left unchanged",
	"Unanchored highlight differs at the same location; note left unchanged",
	"Notebook navigation failed",
	"Notebook navigation timed out",
	"Notebook content unavailable",
	"Kindle session window unavailable",
	"Kindle session window closed",
	"Amazon session expired or notebook unavailable",
	"Amazon session expired or highlight page unavailable",
	"Repeated pagination token",
	"Highlight page unavailable",
	"Not logged in to Amazon Kindle.",
	"Kindle session window is not available. Please log in again.",
	"Kindle session window is not available for loading highlights page. Please log in again.",
	"Amazon notebook load timed out",
	"Amazon notebook could not be inspected",
	"Amazon notebook network load failed",
	"Amazon login network load failed",
	"Amazon notebook content unavailable",
	"Amazon login could not be inspected",
	"Amazon login timed out",
	"Amazon session is not authenticated",
	"Amazon session controller disposed",
	"Unsupported Amazon region",
	"Electron desktop session bridge unavailable",
	"Desktop vault filesystem identity unavailable",
	"Plugin unloaded",
	"Note unavailable",
	"Unsafe folder path",
	"Unreadable note",
	"Login cancelled or not completed",
	"Unexpected error",
	"Invalid note template",
	"Secret storage unavailable",
	"Session could not be saved",
	"Session could not be cleared",
	"Diagnostic record could not be saved",
]);
export function safeErrorMessage(error: unknown): string {
	const message =
		typeof error === "string"
			? error
			: error instanceof Error
				? error.message
				: "";
	if (reasons.has(message)) return message;
	const code = (error as { code?: unknown } | null)?.code;
	if (
		typeof code === "string" &&
		/^(ENOSPC|EACCES|EPERM|ENOENT|EIO|EROFS|EMFILE|EEXIST)$/.test(code)
	)
		return `Filesystem error: ${code}`;
	if (
		/^Filesystem error: (ENOSPC|EACCES|EPERM|ENOENT|EIO|EROFS|EMFILE|EEXIST)$/.test(
			message,
		)
	)
		return message;
	if (message.startsWith("Invalid or unsupported Amazon region:"))
		return "Unsupported Amazon region";
	if (/^Template rendering failed:/.test(message))
		return "Invalid note template";
	return "Unexpected error";
}
export function readErrorRecord(value: unknown): SyncErrorRecord | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as SyncErrorRecord;
	if (
		!["sync", "login", "logout"].includes(v.operation) ||
		!["partial", "failed", "interrupted"].includes(v.status) ||
		typeof v.at !== "string" ||
		!Number.isFinite(Date.parse(v.at)) ||
		typeof v.region !== "string" ||
		!Array.isArray(v.issues) ||
		!v.issues.length
	)
		return undefined;
	const phases = ["auth", "fetch", "metadata", "save", "session"];
	if (
		v.issues.some(
			(i) =>
				!i ||
				!phases.includes(i.phase) ||
				typeof i.message !== "string",
		)
	)
		return undefined;
	const counts = v.counts;
	const validCounts =
		counts &&
		(counts.total === null ||
			(Number.isInteger(counts.total) && counts.total >= 0)) &&
		[counts.completed, counts.failed, counts.held].every(
			(n) => Number.isInteger(n) && n >= 0,
		);
	return {
		at: v.at,
		operation: v.operation,
		region: v.region,
		status: v.status,
		...(validCounts ? { counts: { ...counts } } : {}),
		issues: v.issues.map((i) => ({
			phase: i.phase,
			message: safeErrorMessage(i.message),
			...(typeof i.bookTitle === "string"
				? { bookTitle: i.bookTitle }
				: {}),
			...(typeof i.path === "string" ? { path: i.path } : {}),
		})),
	};
}
export class SyncProgressTracker extends EventEmitter {
	state: SyncProgressState;
	private settled = new Set<string>();
	constructor(metadataEnabled: boolean) {
		super();
		this.state = {
			phase: "auth",
			status: "running",
			currentBook: null,
			metadataEnabled,
			counts: { total: null, completed: 0, failed: 0, held: 0 },
			issues: [],
		};
	}
	private publish() {
		this.emit("change", this.state);
	}
	startPhase(phase: SyncPhase, total: number | null = null) {
		this.settled.clear();
		this.state = {
			...this.state,
			phase,
			status: "running",
			currentBook: null,
			counts: { total, completed: 0, failed: 0, held: 0 },
		};
		this.publish();
	}
	startBook(title: string) {
		this.state = { ...this.state, currentBook: title };
		this.publish();
	}
	settleBook(id: string, status: BookStatus) {
		if (this.settled.has(id)) return;
		this.settled.add(id);
		const counts = { ...this.state.counts };
		if (status === "failed") counts.failed++;
		else if (status === "held") counts.held++;
		else counts.completed++;
		this.state = { ...this.state, counts, currentBook: null };
		this.publish();
	}
	addIssue(issue: SyncIssue) {
		const safe = { ...issue, message: safeErrorMessage(issue.message) };
		if (
			this.state.issues.some(
				(i) => JSON.stringify(i) === JSON.stringify(safe),
			)
		)
			return;
		this.state = { ...this.state, issues: [...this.state.issues, safe] };
		this.publish();
	}
	finish(status: SyncProgressState["status"], counts = this.state.counts) {
		this.state = {
			...this.state,
			status,
			counts: { ...counts },
			currentBook: null,
		};
		this.publish();
	}
}
