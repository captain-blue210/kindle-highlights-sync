export interface Book {
	id: string; // Typically the ASIN
	title: string;
	author: string;
	asin: string; // Add ASIN field
	url: string; // Add URL field
	imageUrl?: string; // Rename coverUrl and keep optional
	lastAnnotatedDate?: Date | null; // Add optional date field
	metadata?: Record<string, any>; // Keep metadata field
}
