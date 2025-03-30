export interface Highlight {
	id: string;
	bookId: string;
	text: string;
	location: string;
	page?: number;
	createdAt?: Date;
	note?: string;
	color?: string; // Added color field
}
