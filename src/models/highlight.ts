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
	color?: string; // Added color field
	appLink?: string; // Add kindle:// link
}
