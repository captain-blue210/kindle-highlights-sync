import { describe, expect, it, vi } from "vitest"; // Import vi

// Mock the 'obsidian' module
vi.mock("obsidian", () => {
	return {
		Notice: vi.fn(), // Mock the Notice class/function
		// Add mocks for any other obsidian imports if needed later
	};
});

import { Book } from "../models"; // Assuming Book model path
import { renderTemplate } from "./template-renderer";

// Mock Book data for testing
const mockBook: Book = {
	id: "B00TESTASIN",
	title: "Test Book Title",
	author: "Test Author",
	asin: "B00TESTASIN",
	url: "https://amazon.com/dp/B00TESTASIN",
	imageUrl: "https://images.amazon.com/images/I/test.jpg",
	lastAnnotatedDate: new Date("2024-01-15T10:00:00Z"),
	metadata: {
		authorUrl: "https://example.com/author/test",
		publicationDate: "2023-05-20",
		publisher: "Test Publisher",
		appLink: "kindle://book?action=open&asin=B00TESTASIN",
	},
};

// Mock pre-formatted highlights string
const mockHighlightsString = `- Highlight 1 text
- Highlight 2 text
  - Note: This is a note for highlight 2`;

// Mock context data matching TemplateContext structure + extras
const mockContext = {
	book: mockBook,
	...mockBook, // Spread book properties
	highlights: mockHighlightsString,
	highlightsCount: 2,
	lastAnnotatedDate: "2024-01-15", // Formatted date
	authorUrl: mockBook.metadata?.authorUrl,
	publicationDate: mockBook.metadata?.publicationDate,
	publisher: mockBook.metadata?.publisher,
	appLink: mockBook.metadata?.appLink,
};

// The default Nunjucks template from settings
const defaultTemplate = `---
aliases:
tags: ["読書/{{author}}/{{title}}"]
created:
updated:
---

{% if imageUrl %}![image]({{imageUrl}})
{% endif %}

## 書籍情報
{% if authorUrl %}
* 著者: [{{author}}]({{authorUrl}})
{% elif author %}
* 著者: [[{{author}}]]
{% endif %}
{% if highlightsCount %}* ハイライト数: {{highlightsCount}}{% endif %}
{% if lastAnnotatedDate %}* 最後にハイライトした日: {{lastAnnotatedDate}}{% endif %}
{% if publicationDate %}* 発行日: {{publicationDate}}{% endif %}
{% if publisher %}* 出版社: {{publisher}}{% endif %}
{% if url %}* [Amazon link]({{url}}){% endif %}
{% if appLink %}* [Kindle link]({{appLink}}){% endif %}
\n
## ハイライト
{{highlights}}
`;

describe("renderTemplate (Nunjucks)", () => {
	it("should render the default template correctly with full data", () => {
		const expectedOutput = `---
aliases:
tags: ["読書/Test Author/Test Book Title"]
created:
updated:
---

![image](https://images.amazon.com/images/I/test.jpg)

## 書籍情報
* 著者: [Test Author](https://example.com/author/test)
* ハイライト数: 2* 最後にハイライトした日: 2024-01-15* 発行日: 2023-05-20* 出版社: Test Publisher* [Amazon link](https://amazon.com/dp/B00TESTASIN)* [Kindle link](kindle://book?action=open&asin=B00TESTASIN)

## ハイライト
- Highlight 1 text
- Highlight 2 text
  - Note: This is a note for highlight 2
`;
		const result = renderTemplate(defaultTemplate, mockContext);
		// Normalize whitespace/newlines for comparison if needed, but exact match is better
		expect(result.trim()).toBe(expectedOutput.trim());
	});

	it("should render correctly when optional fields are missing", () => {
		const partialBook: Book = {
			...mockBook,
			imageUrl: undefined, // Missing imageUrl
			metadata: {
				// Missing authorUrl, publicationDate, publisher, appLink
				...mockBook.metadata,
				authorUrl: undefined,
				publicationDate: undefined,
				publisher: undefined,
				appLink: undefined,
			},
		};

		// Format the date from partialBook correctly for the context
		const formattedPartialLastAnnotatedDate = partialBook.lastAnnotatedDate
			? partialBook.lastAnnotatedDate.toISOString().split("T")[0]
			: undefined;

		// Rebuild partialContext ensuring correct types
		const partialContext = {
			book: partialBook, // Include the book object
			...partialBook, // Spread properties from partialBook
			// Override/add specific context properties with correct types
			highlights: mockHighlightsString, // Use the same highlights string
			highlightsCount: mockContext.highlightsCount, // Use the same count
			lastAnnotatedDate: formattedPartialLastAnnotatedDate, // Use the formatted date (string | undefined)
			// Explicitly set other optional fields from partialBook or undefined
			authorUrl: partialBook.metadata?.authorUrl, // undefined in this case
			publicationDate: partialBook.metadata?.publicationDate, // undefined
			publisher: partialBook.metadata?.publisher, // undefined
			appLink: partialBook.metadata?.appLink, // undefined
			imageUrl: partialBook.imageUrl, // undefined
		};

		const expectedOutput = `---
aliases:
tags: ["読書/Test Author/Test Book Title"]
created:
updated:
---


## 書籍情報
* 著者: [[Test Author]]
* ハイライト数: 2* 最後にハイライトした日: 2024-01-15* [Amazon link](https://amazon.com/dp/B00TESTASIN)

## ハイライト
- Highlight 1 text
- Highlight 2 text
  - Note: This is a note for highlight 2
`;
		const result = renderTemplate(defaultTemplate, partialContext);
		expect(result.trim()).toBe(expectedOutput.trim());
	});

	it("should handle simple variable replacement", () => {
		const simpleTemplate = "Title: {{title}}, Author: {{author}}";
		const result = renderTemplate(simpleTemplate, mockContext);
		expect(result).toBe("Title: Test Book Title, Author: Test Author");
	});

	it("should throw an error for a malformed template", () => {
		const badTemplate = "Title: {{ title"; // Missing closing braces
		// Expect the renderTemplate function to throw an error when called with bad template
		// Adjust regex to account for "(unknown path)" and potential newlines in the error message
		expect(() => renderTemplate(badTemplate, mockContext)).toThrow(
			/Template rendering failed:.*\(unknown path\)\s*expected variable end/s
		);
	});
});
