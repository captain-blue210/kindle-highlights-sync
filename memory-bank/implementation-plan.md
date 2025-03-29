# Kindle Highlights Sync - Implementation Plan

**Goal:** Implement the features described in `README.md`, focusing on direct scraping of Kindle Cloud Reader highlights and metadata within the Obsidian plugin.

**Approach:** Adopt a direct HTTP scraping method, similar to the `hadynz/obsidian-kindle-plugin`, using Obsidian's `requestUrl` API and handling authentication via a custom login modal.

**Steps:**

1.  **Implement Authentication:**
    *   Replace the current basic `KindleLoginModal` in `src/main.ts`.
    *   Create a new `AmazonLoginModal` that uses `requestUrl` to perform Amazon login steps, capturing session cookies. Handle potential MFA.
2.  **Implement Scraping Logic:**
    *   **Identify Endpoints:** Research (e.g., via browser network inspection) the specific API endpoints `read.amazon.com` uses for listing books and fetching highlights.
    *   **Develop `scrapeKindleHighlights`:** Rewrite the function in `src/services/kindle-api.ts` to:
        *   Use `requestUrl` to call the identified Amazon endpoints.
        *   Include authentication cookies in request headers.
        *   Parse the response (HTML/JSON) to extract book/highlight data into models.
3.  **Implement Metadata Fetching:**
    *   Update `fetchBookMetadata` in `src/services/metadata-service.ts` to extract metadata from Kindle data (ASIN, cover URL) or make additional authenticated calls. Consider OpenLibrary as a fallback.
4.  **Refactor `syncHighlights`:** Ensure the main function in `src/main.ts` correctly calls the new login modal and updated scraping functions.
5.  **Error Handling & Maintenance:** Implement robust error handling for network issues, login failures, and potential Amazon site changes. Add comments about fragility.
6.  **Testing:** Thoroughly test the login and sync process across different scenarios.

**Diagram:**

```mermaid
graph TD
    Start[Analyze Reference Plugin] --> Feasible{Direct Scraping Confirmed};
    Feasible --> Plan[Adopt Direct HTTP Scraping];
    Plan --> Step1[Implement New Login Modal (HTTP Auth)];
    Step1 --> Step2[Identify Amazon API Endpoints];
    Step2 --> Step3[Implement Scraping Functions (requestUrl + Cookies)];
    Step3 --> Step4[Implement Metadata Fetching (from Amazon data)];
    Step4 --> Step5[Refactor main sync flow];
    Step5 --> Step6[Add Robust Error Handling];
    Step6 --> Step7[Test Thoroughly];
    Step7 --> End[Implementation Ready];
```

**Next Action:** Switch to Code mode to begin implementation based on this plan.
