# Product Context: Obsidian Kindle Highlights Sync

## 1. Why This Project Exists

Reading on Kindle is convenient, but integrating the generated highlights and notes into a personal knowledge base like Obsidian often involves friction. Users desire a seamless way to bring their reading insights into their Obsidian vault without manual steps, allowing them to easily connect ideas and build upon their knowledge.

## 2. Problems Solved

*   **Manual Export/Import:** Eliminates the need for users to manually export highlights from Kindle (e.g., via email, website copy-paste) and import them into Obsidian.
*   **Data Silos:** Bridges the gap between the Kindle reading ecosystem and the Obsidian knowledge management environment.
*   **Workflow Interruption:** Reduces context switching and keeps users within their Obsidian workflow when they want to access their Kindle annotations.

## 3. How It Should Work (User Workflow)

1.  **Installation:** User installs the plugin from the Obsidian community plugins browser.
2.  **Initial Setup (Authentication):**
    *   User triggers the sync action for the first time (via ribbon icon or command palette).
    *   An Amazon login modal appears.
    *   User logs into their Amazon account securely within the modal.
    *   Successful login is detected, and the modal closes. The session is established.
3.  **Synchronization:**
    *   User triggers the sync action (ribbon icon or command palette).
    *   The plugin communicates with the Kindle Cloud Reader in the background using the established session.
    *   New or updated highlights and notes are fetched.
    *   Corresponding notes are created or updated within Obsidian according to basic default settings.
    *   A notification confirms sync completion (or reports errors).
4.  **Configuration (Optional):** Users can access plugin settings to potentially adjust the target folder, note format (using a simple default template initially), and Amazon region if needed.
5.  **Logout:** User can explicitly log out via a command or settings option, clearing the session data.

## 4. User Experience Goals

*   **Simplicity:** The primary goal is a "one-click" sync experience after the initial setup. Authentication should be straightforward and secure.
*   **Reliability:** Synchronization should consistently fetch all available highlights and handle potential errors gracefully (e.g., network issues, login expiry).
*   **Unobtrusiveness:** Background processing should minimize disruption to the user's ongoing work in Obsidian. Clear notifications should provide status updates without being intrusive.
*   **Discoverability:** Key actions like initiating sync and accessing settings should be easily discoverable through standard Obsidian UI elements (ribbon, command palette, settings tab).
