# Active Context: Obsidian Kindle Highlights Sync (2025-03-29)

## 1. Current Focus

The immediate focus is on **implementing the Amazon Kindle Cloud Reader authentication mechanism** within the Obsidian plugin. This involves:

*   Creating and refining the `AmazonLoginModal`.
*   Embedding the Amazon login page securely within the modal.
*   Detecting successful login by monitoring URL redirection within the embedded view.
*   Establishing and potentially managing the user's Amazon session (cookies) for subsequent API calls or data scraping.
*   Implementing the corresponding logout functionality (`AmazonLogoutModal` and session clearing).

## 2. Recent Changes

*   Established the core Memory Bank documents:
    *   `projectbrief.md`
    *   `productContext.md`
    *   `techContext.md`
    *   `systemPatterns.md`
*   Clarified project goals, user experience priorities (simplicity), technical stack, and basic system architecture.

## 3. Next Steps (High-Level Plan for Login Feature)

1.  **Develop `AmazonLoginModal`:**
    *   Create the basic modal structure using Obsidian API (`Modal`).
    *   Embed an `iframe` within the modal's content area.
    *   Load the appropriate Amazon login URL based on the user's selected region (from settings).
2.  **Implement Login Detection:**
    *   Add event listeners to the `iframe` to monitor `load` or navigation events.
    *   Check the URL of the loaded page within the `iframe`.
    *   If the URL matches the expected Kindle Cloud Reader URL for the region, consider the login successful.
3.  **Handle Session:**
    *   Determine how the session (cookies) established within the `iframe` context can be leveraged for subsequent data fetching by `KindleApiService`. (This might involve Obsidian's `requestUrl` capabilities or potentially interacting with the `iframe`'s content window if security policies allow).
    *   Communicate login success/status back to the main plugin/service.
4.  **Develop Logout Functionality:**
    *   Create `AmazonLogoutModal` (potentially just a confirmation).
    *   Implement logic to clear relevant cookies or session data. This is complex due to the `iframe` context and browser security. Research needed on effective methods within Obsidian's environment (e.g., navigating the iframe to a logout URL, attempting to clear cookies via specific APIs if available).
5.  **Integrate with `KindleApiService`:** Ensure the service can check the login status and utilize the established session.
6.  **Refine Settings:** Add settings for Amazon region selection if not already present.
7.  **Testing:** Thoroughly test login/logout across different regions and scenarios (e.g., incorrect password, 2FA).

## 4. Active Decisions & Considerations

*   **Session Management:** How exactly will the session established in the `iframe` be accessed and used by the plugin's background processes/services? Are there security limitations within Obsidian/Electron regarding cross-context cookie access? Will `requestUrl` automatically use these cookies if the requests target the same domain? *Further investigation required.*
*   **Logout Mechanism:** What is the most reliable way to clear the Amazon session cookies from within the Obsidian plugin context, given they were likely set within an `iframe`? *Further investigation required.*
*   **WebView Component:** The initial request mentioned "WebView (または同等のコンポーネント)". Obsidian Modals typically use standard HTML DOM. We will use an `iframe` as the standard way to embed external web content within this structure.
*   **Error Handling:** Define specific error handling for login failures (wrong credentials, network issues, Amazon changes login flow).
*   **Region Handling:** Ensure login URLs and Cloud Reader redirect URLs are correctly mapped for different Amazon regions (.com, .co.jp, .de, .co.uk, etc.).
