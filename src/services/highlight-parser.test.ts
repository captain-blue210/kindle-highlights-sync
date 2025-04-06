import * as cheerio from "cheerio"; // Use namespace import for Cheerio
import { beforeEach, describe, expect, it, vi } from "vitest"; // Import vi
import { Book } from "../models"; // Assuming models are in ../models
import { HighlightParser } from "./highlight-parser"; // Assuming HighlightParser is a class

// Mock the 'obsidian' module
vi.mock("obsidian", () => ({
	Notice: vi.fn(),
	App: vi.fn(), // Keep mocks minimal unless specific properties are needed
}));

// Mock AmazonLoginModal to prevent errors related to Electron/window
vi.mock("../modals/AmazonLoginModal", () => ({
	AmazonLoginModal: vi.fn().mockImplementation(() => ({
		open: vi.fn(),
		onClose: vi.fn(),
		// Add other methods/properties if needed by the dependency chain
	})),
}));

// Mock remote-loader to prevent errors related to Electron/window
vi.mock("../utils/remote-loader", () => ({
	getRemote: vi.fn(() => ({
		// Mock the structure returned by getRemote if needed
		require: vi.fn(),
		// Add other properties/methods of the remote object if needed
	})),
	// Mock other exports if necessary
}));

// Mock HTML snippets for testing
const MOCK_HTML_SINGLE_BOOK_MULTIPLE_HIGHLIGHTS = `
<div id="kp-notebook-library">
  <div class="kp-notebook-library-each-book" id="BOOK_ASIN_1">
    <h2 class="kp-notebook-metadata">Test Book Title 1</h2>
    <p class="kp-notebook-metadata"><span>By: </span>Test Author 1</p>
    <span class="kp-notebook-metadata">Last annotated on Thursday, January 1, 2024</span>
    <img src="http://example.com/image1.jpg" class="kp-notebook-cover-image"/>
    <a class="kp-notebook-read-more-link" href="https://read.amazon.com/notebook?asin=BOOK_ASIN_1">Read more</a>
  </div>
</div>
<div id="kp-notebook-annotations">
  <div id="highlight_1" class="kp-notebook-highlight" data-asin="BOOK_ASIN_1">
    <span class="kp-notebook-highlight-text">This is the first highlight text.</span>
    <span class="kp-notebook-highlight-location">Location 100</span>
    <span class="kp-notebook-highlight-color">yellow</span>
  </div>
  <div id="note_1" class="kp-notebook-note" data-asin="BOOK_ASIN_1">
     <span class="kp-notebook-note-text">This is a note for the first highlight.</span>
  </div>
  <div id="highlight_2" class="kp-notebook-highlight" data-asin="BOOK_ASIN_1">
    <span class="kp-notebook-highlight-text">This is the second highlight text, no note.</span>
    <span class="kp-notebook-highlight-location">Location 200</span>
    <span class="kp-notebook-highlight-color">blue</span>
  </div>
</div>
`;

const MOCK_HTML_MULTIPLE_BOOKS = `
<div id="kp-notebook-library">
  <div class="kp-notebook-library-each-book" id="BOOK_ASIN_1">
    <h2 class="kp-notebook-metadata">Test Book Title 1</h2>
    <p class="kp-notebook-metadata"><span>By: </span>Test Author 1</p>
    <span class="kp-notebook-metadata">Last annotated on Thursday, January 1, 2024</span>
    <img src="http://example.com/image1.jpg" class="kp-notebook-cover-image"/>
    <a class="kp-notebook-read-more-link" href="https://read.amazon.com/notebook?asin=BOOK_ASIN_1">Read more</a>
  </div>
  <div class="kp-notebook-library-each-book" id="BOOK_ASIN_2">
    <h2 class="kp-notebook-metadata">Test Book Title 2</h2>
    <p class="kp-notebook-metadata"><span>By: </span>Test Author 2</p>
    <span class="kp-notebook-metadata">Last annotated on Friday, January 2, 2024</span>
    <img src="http://example.com/image2.jpg" class="kp-notebook-cover-image"/>
    <a class="kp-notebook-read-more-link" href="https://read.amazon.com/notebook?asin=BOOK_ASIN_2">Read more</a>
  </div>
</div>
<div id="kp-notebook-annotations">
  <div id="highlight_1" class="kp-notebook-highlight" data-asin="BOOK_ASIN_1">
    <span class="kp-notebook-highlight-text">Highlight from book 1.</span>
    <span class="kp-notebook-highlight-location">Location 10</span>
    <span class="kp-notebook-highlight-color">yellow</span>
  </div>
   <div id="highlight_3" class="kp-notebook-highlight" data-asin="BOOK_ASIN_2">
    <span class="kp-notebook-highlight-text">Highlight from book 2.</span>
    <span class="kp-notebook-highlight-location">Location 30</span>
    <span class="kp-notebook-highlight-color">pink</span>
  </div>
</div>
`;

const MOCK_HTML_NO_HIGHLIGHTS = `
<div id="kp-notebook-library">
  <div class="kp-notebook-library-each-book" id="BOOK_ASIN_3">
    <h2 class="kp-notebook-metadata">Book With No Highlights</h2>
    <p class="kp-notebook-metadata"><span>By: </span>Author Three</p>
    <span class="kp-notebook-metadata">Never annotated</span>
    <img src="http://example.com/image3.jpg" class="kp-notebook-cover-image"/>
    <a class="kp-notebook-read-more-link" href="https://read.amazon.com/notebook?asin=BOOK_ASIN_3">Read more</a>
  </div>
</div>
<div id="kp-notebook-annotations">
  </div>
`;

const MOCK_HTML_EMPTY = ``;

describe("HighlightParser", () => {
	let parser: HighlightParser;

	beforeEach(() => {
		parser = new HighlightParser(); // Instantiate before each test
	});

	// --- Tests for parseNotebookPage ---
	describe("parseNotebookPage", () => {
		it("should correctly parse book metadata from HTML with one book", () => {
			const $ = cheerio.load(MOCK_HTML_SINGLE_BOOK_MULTIPLE_HIGHLIGHTS);
			const result = parser.parseNotebookPage($, "com"); // Use parseNotebookPage

			expect(result).toHaveLength(1);
			const book = result[0];
			expect(book.asin).toBe("BOOK_ASIN_1");
			expect(book.title).toBe("Test Book Title 1");
			expect(book.author).toBe("Test Author 1");
			expect(book.imageUrl).toBe("http://example.com/image1.jpg");
			expect(book.url).toBe(
				"https://read.amazon.com/notebook?asin=BOOK_ASIN_1"
			);
			// Add check for lastAnnotatedDate if parseToDateString is stable
			// expect(book.lastAnnotatedDate).toEqual(new Date('2024-01-01'));

			// Highlights are parsed separately, remove checks here
		});

		it("should correctly parse book metadata from HTML with multiple books", () => {
			const $ = cheerio.load(MOCK_HTML_MULTIPLE_BOOKS);
			const result = parser.parseNotebookPage($, "com"); // Use parseNotebookPage

			expect(result).toHaveLength(2);

			// Book 1 checks
			const book1 = result.find((b: Book) => b.asin === "BOOK_ASIN_1");
			expect(book1).toBeDefined();
			expect(book1?.title).toBe("Test Book Title 1");
			expect(book1?.author).toBe("Test Author 1");
			// Remove highlight checks

			// Book 2 checks
			const book2 = result.find((b: Book) => b.asin === "BOOK_ASIN_2");
			expect(book2).toBeDefined();
			expect(book2?.title).toBe("Test Book Title 2");
			expect(book2?.author).toBe("Test Author 2");
			// Remove highlight checks
		});

		it("should parse book metadata even if no highlights exist for the book", () => {
			const $ = cheerio.load(MOCK_HTML_NO_HIGHLIGHTS);
			const result = parser.parseNotebookPage($, "com"); // Use parseNotebookPage

			// Depending on implementation: either return the book with empty highlights array,
			// or filter out books with no highlights. Let's assume it returns the book.
			expect(result).toHaveLength(1);
			const book = result[0];
			expect(book.asin).toBe("BOOK_ASIN_3");
			expect(book.title).toBe("Book With No Highlights");
			// Remove highlight check
		});

		it("should handle empty HTML input gracefully", () => {
			const $ = cheerio.load(MOCK_HTML_EMPTY);
			const result = parser.parseNotebookPage($, "com"); // Use parseNotebookPage
			expect(result).toEqual([]); // Expect an empty array for empty input
		});

		it("should handle missing optional book elements gracefully", () => {
			const MOCK_HTML_MISSING_BOOK_ELEMENTS = `
	     <div id="kp-notebook-library">
	       <div class="kp-notebook-library-each-book" id="BOOK_ASIN_4">
	         <h2 class="kp-notebook-searchable">Book With Missing Info</h2>
	         </div>
	     </div>
	     `; // Only book info, no annotations needed here
			const $ = cheerio.load(MOCK_HTML_MISSING_BOOK_ELEMENTS);
			const result = parser.parseNotebookPage($, "com"); // Use parseNotebookPage

			expect(result).toHaveLength(1);
			const book = result[0];
			expect(book.asin).toBe("BOOK_ASIN_4");
			expect(book.title).toBe("Book With Missing Info");
			expect(book.author).toBeUndefined();
			expect(book.imageUrl).toBeUndefined();
			expect(book.url).toBeUndefined();
			expect(book.lastAnnotatedDate).toBeNull(); // Expect null as parseToDateString returns null for invalid/missing input

			// Remove highlight checks
		});
	}); // End describe('parseNotebookPage')

	// --- Tests for parseHighlightsPage ---
	describe("parseHighlightsPage", () => {
		const BOOK_ASIN_1 = "BOOK_ASIN_1";

		// Extract only the annotations part for these tests
		const ANNOTATIONS_HTML_SINGLE_BOOK = `
		    <div id="kp-notebook-annotations">
		      <div id="highlight_1" class="kp-notebook-highlight a-row a-spacing-base" data-asin="BOOK_ASIN_1">
		        <span id="highlight" class="kp-notebook-highlight-text">This is the first highlight text.</span>
		        <input type="hidden" id="kp-annotation-location" value="100">
		        <span class="kp-notebook-highlight kp-notebook-highlight-yellow"></span> <!-- Color element -->
		      </div>
		      <div id="note_1" class="kp-notebook-note a-row a-spacing-base" data-asin="BOOK_ASIN_1">
		         <span id="note" class="kp-notebook-note-text">This is a note for the first highlight.</span>
		         <input type="hidden" id="kp-annotation-location" value="100"> <!-- Note also has location -->
		      </div>
		      <div id="highlight_2" class="kp-notebook-highlight a-row a-spacing-base" data-asin="BOOK_ASIN_1">
		        <span id="highlight" class="kp-notebook-highlight-text">This is the second highlight text, no note.</span>
		        <input type="hidden" id="kp-annotation-location" value="200">
		        <span class="kp-notebook-highlight kp-notebook-highlight-blue"></span> <!-- Color element -->
		      </div>
		    </div>
		  `;

		const ANNOTATIONS_HTML_MISSING_ELEMENTS = `
		    <div id="kp-notebook-annotations">
		      <div id="highlight_4" class="a-row a-spacing-base" data-asin="BOOK_ASIN_4">
		        <span id="highlight">Highlight with no location or color.</span>
		        <!-- Missing location input and color span -->
		      </div>
		       <div id="note_only" class="a-row a-spacing-base" data-asin="BOOK_ASIN_4">
		         <span id="note">Just a note, no highlight text.</span>
		         <input type="hidden" id="kp-annotation-location" value="500">
		      </div>
		    </div>
		  `;

		it("should correctly parse highlights and notes from annotation HTML", () => {
			const $ = cheerio.load(ANNOTATIONS_HTML_SINGLE_BOOK);
			const result = parser.parseHighlightsPage($, BOOK_ASIN_1);

			expect(result).toHaveLength(2); // Two highlights expected

			// Highlight 1
			expect(result[0].text).toBe("This is the first highlight text.");
			expect(result[0].location).toBe("100"); // Expecting extracted number string
			expect(result[0].color).toBe("yellow");
			expect(result[0].note).toBe(
				"This is a note for the first highlight."
			); // Note text associated correctly
			expect(result[0].appLink).toBe(
				"kindle://book?action=open&asin=BOOK_ASIN_1&location=100"
			);

			// Highlight 2
			expect(result[1].text).toBe(
				"This is the second highlight text, no note."
			);
			expect(result[1].location).toBe("200");
			expect(result[1].color).toBe("blue");
			expect(result[1].note).toBeUndefined(); // No note for this one
			expect(result[1].appLink).toBe(
				"kindle://book?action=open&asin=BOOK_ASIN_1&location=200"
			);
		});

		it("should handle missing optional highlight elements gracefully", () => {
			const $ = cheerio.load(ANNOTATIONS_HTML_MISSING_ELEMENTS);
			const result = parser.parseHighlightsPage($, "BOOK_ASIN_4");

			expect(result).toHaveLength(1); // Only one actual highlight text found

			expect(result[0].text).toBe("Highlight with no location or color.");
			expect(result[0].location).toBeUndefined();
			expect(result[0].color).toBeUndefined();
			expect(result[0].note).toBeUndefined();
			expect(result[0].appLink).toBeUndefined();
		});

		it("should handle empty annotation HTML input gracefully", () => {
			const $ = cheerio.load("");
			const result = parser.parseHighlightsPage($, "ANY_ASIN");
			expect(result).toEqual([]);
		});

		// Add more tests for edge cases:
		// - Malformed HTML within annotations
		// - Variations in location format
		// - Highlights spanning multiple elements (if possible)
		// - Different note structures
	}); // End describe('parseHighlightsPage')
}); // End describe('HighlightParser')
