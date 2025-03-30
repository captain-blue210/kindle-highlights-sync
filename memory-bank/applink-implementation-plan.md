# Plan: Implement Kindle AppLink Generation

**Date:** 2025-03-30

**Goal:** Generate a `kindle://` deep link (`appLink`) for each highlight and insert it into the Markdown output generated in `src/main.ts`.

**Context:** This link allows users to directly jump from the Obsidian note to the specific highlight location in their Kindle app or device.

**Plan Steps:**

1.  **Locate Target Code:** Identify the `.map()` function within the `syncHighlights` method in `src/main.ts` (around lines 182-190). This function iterates through `bookHighlights`.
2.  **Access Required Data:** Inside the `map` callback function (parameter `h` representing the current highlight), access:
    *   The current highlight object: `h` (provides `h.location`).
    *   The current book object: `book` (from the outer `for...of` loop, provides `book.asin`).
3.  **Construct `appLink`:**
    *   Declare a variable `appLink`.
    *   Initialize it with the base URL format: `kindle://book?action=open&asin=${book.asin}`.
    *   Conditionally check if `h.location` exists and is not empty.
    *   If `h.location` is present, append the location parameter: `&location=${h.location}`.
4.  **Update Markdown Output:** Modify the line creating the `item` string (currently line 184) to embed the `appLink` variable within the Markdown link syntax: `[${h.location}](${appLink})`.
5.  **Implementation:** Switch to "code" mode and apply the necessary changes using the `apply_diff` tool.

**Proposed Code Snippet (within the `.map` callback in `src/main.ts`):**

```typescript
// Construct the appLink based on asin and location
let appLink = `kindle://book?action=open&asin=${book.asin}`;
if (h.location) {
    appLink += `&location=${h.location}`;
}

// Use the appLink in the Markdown output
let item = `- ${h.text}\n [${h.location}](${appLink})`; // <-- Link inserted here
if (h.note) {
    // Indent note under the highlight
    item += `\n  - Note: ${h.note}`;
}
return item;
