export interface Book {
	id: string; // Typically the ASIN
	title: string;
	author?: string; // Make author optional (string | undefined)
	asin: string; // Add ASIN field
	url?: string; // Make URL field optional
	imageUrl?: string; // Rename coverUrl and keep optional
	lastAnnotatedDate?: Date | null; // Add optional date field
	metadata?: Record<string, any>; // Keep metadata field
}
