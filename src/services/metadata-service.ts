import type { Book } from "../models";

/**
 * Fetches or structures additional book metadata.
 * Currently, it primarily structures the ASIN obtained during scraping.
 * Can be expanded to fetch from external APIs like OpenLibrary if needed.
 */
export async function fetchBookMetadata(
	book: Book, // Accept the full book object
	region: string, // Keep for potential future API calls
	fetchExternal: boolean // Corresponds to settings.downloadMetadata
): Promise<Record<string, any>> {
	console.log(
		`Structuring metadata for Book ID (ASIN): ${book.id}, Title: ${book.title}`
	);

	// Initialize metadata with known details from scraping
	const metadata: Record<string, any> = {
		asin: book.id, // ASIN is the book ID from scraping
		title: book.title,
		author: book.author,
		coverUrl: book.coverUrl, // Pass along coverUrl if scraped
	};

	// --- Optional: Fetch additional data from external source ---
	if (fetchExternal) {
		console.log(`External metadata fetching enabled for ${book.title}`);
		// TODO: Implement external fetching logic if desired, e.g., OpenLibrary
		// This requires uncommenting and potentially adapting the OpenLibrary example below
		// or implementing calls to another service.

		/* Example: Using OpenLibrary API (requires requestUrl)
        try {
            const query = encodeURIComponent(`title:${book.title} author:${book.author}`);
            // Alternative: Use ASIN if OpenLibrary supports it: const query = encodeURIComponent(`isbn:${book.id}`);
            const url = `https://openlibrary.org/search.json?q=${query}`;
            const response = await requestUrl({ url, throw: false });

            if (response.status === 200) {
                const data = response.json;
                if (data.docs && data.docs.length > 0) {
                    const bookData = data.docs[0];
                    console.log(`Found metadata on OpenLibrary for ${book.title}`);
                    // Add or overwrite fields in metadata object
                    metadata.openLibraryId = bookData.key;
                    metadata.publicationYear = bookData.first_publish_year;
                    // Add other relevant fields: subject, publisher, etc.
                    // metadata.description = bookData.first_sentence_value; // Example
                } else {
                     console.log(`No metadata found on OpenLibrary for ${book.title}`);
                }
            } else {
                console.warn(`OpenLibrary request failed for ${book.title}: Status ${response.status}`);
            }
        } catch (error) {
            console.error(`Error fetching OpenLibrary metadata for ${book.title}:`, error);
            metadata.fetchError = `OpenLibrary: ${error.message}`;
        }
        */
	} else {
		console.log(`External metadata fetching disabled for ${book.title}`);
	}

	return metadata;
}
