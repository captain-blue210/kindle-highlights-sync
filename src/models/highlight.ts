export interface Highlight {
	id: string;
	/** Observed Amazon DOM operation IDs, not a verified stable sync identity. */
	sourceAnnotationId?: string;
	sourceHighlightId?: string;
	bookId: string;
	text: string;
	location: string;
	page?: number;
	createdAt?: Date;
	note?: string;
	/** Distinct Markdown memos attached to this source highlight. */
	notes?: string[];
	/** Present only on an independently persisted attached memo. */
	parentAnnotationKey?: string;
	color?: string; // Added color field
	appLink?: string; // Add kindle:// link
}
