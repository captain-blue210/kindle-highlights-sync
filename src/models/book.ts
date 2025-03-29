export interface Book {
	id: string;
	title: string;
	author: string;
	coverUrl?: string;
	metadata?: Record<string, any>;
}
