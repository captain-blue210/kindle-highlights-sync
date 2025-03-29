# System Patterns: Obsidian Kindle Highlights Sync

## 1. Overall Architecture

The plugin follows a relatively simple, centralized architecture rather than adhering strictly to a formal design pattern like MVC or MVVM. The core `KindleHighlightsPlugin` class (`src/main.ts`) acts as the central orchestrator.

## 2. Key Components & Interactions

```mermaid
graph TD
    User --> ObsidianUI[Obsidian UI (Ribbon, Command Palette, Settings)]
    ObsidianUI --> MainPlugin(KindleHighlightsPlugin / main.ts)

    subgraph Plugin Core
        MainPlugin --> SettingsTab(SettingsTab / settings.ts)
        MainPlugin -->|Triggers Sync| SyncProcess{Sync Logic}
        MainPlugin -->|Needs Login| LoginModal(AmazonLoginModal / modals/AmazonLoginModal.ts)
        MainPlugin -->|Needs Logout| LogoutModal(AmazonLogoutModal / modals/AmazonLogoutModal.ts) -- Planned
        MainPlugin -->|Displays Status| NoticeAPI[Obsidian Notice API]

        SyncProcess --> KindleAPI(KindleApiService / services/kindle-api.ts)
        SyncProcess --> Parser(HighlightParser / services/highlight-parser.ts) -- Planned/Implicit
        SyncProcess --> Renderer(TemplateRenderer / services/template-renderer.ts)
        SyncProcess --> MetadataService(MetadataService / services/metadata-service.ts) -- Planned/Implicit
        SyncProcess --> VaultAPI[Obsidian Vault API]

        KindleAPI -->|Fetches Data| AmazonCloudReader[Amazon Cloud Reader (via embedded view/requests)]
        Renderer --> VaultAPI
    end

    SettingsTab --> MainPlugin -- Saves Settings

    LoginModal -->|Handles Login| AmazonCloudReader
    LoginModal -->|On Success/Failure| MainPlugin

    LogoutModal -->|Handles Logout| MainPlugin -- Planned
```

*   **`KindleHighlightsPlugin` (`src/main.ts`):**
    *   The main entry point and central controller.
    *   Initializes the plugin, loads settings, registers commands, adds ribbon icons, and sets up the settings tab.
    *   Orchestrates the synchronization process, deciding when to show the login modal or proceed with fetching data.
    *   Instantiates and interacts with various `Service` classes.
*   **`SettingsTab` (`src/settings.ts`):**
    *   Provides the user interface for configuring plugin settings (e.g., Amazon region, note template, output folder).
    *   Saves settings using Obsidian's data persistence mechanisms.
*   **`AmazonLoginModal` (`src/modals/AmazonLoginModal.ts`):**
    *   Displays the Amazon login page within an embedded view (likely an `iframe`).
    *   Monitors navigation within the embedded view to detect successful login (redirection to Kindle Cloud Reader URL).
    *   Communicates login success or failure back to the `MainPlugin`.
    *   Handles the storage or management of the session/cookies upon successful login (details TBD).
*   **`AmazonLogoutModal` (Planned):**
    *   Provides a confirmation or interface for logging out.
    *   Triggers the clearing of session data (cookies).
*   **Services (`src/services/`):**
    *   **`KindleApiService` (`kindle-api.ts`):** Responsible for all communication related to Amazon, including managing the login state (session/cookies) and fetching data (books, highlights) from the Cloud Reader. This will likely involve interacting with the embedded view's content or making authenticated requests.
    *   **`HighlightParser` (`highlight-parser.ts`):** Parses the raw data fetched from Kindle Cloud Reader into structured `Book` and `Highlight` models. (Functionality might be partially within `KindleApiService` initially).
    *   **`TemplateRenderer` (`template-renderer.ts`):** Takes the structured data and user-defined templates to generate the Markdown content for Obsidian notes.
    *   **`MetadataService` (`metadata-service.ts`):** Potentially handles fetching or enriching book metadata (e.g., cover images, author details) if not directly available from the primary highlight data source.
*   **Models (`src/models/`):** Defines the data structures (`Book`, `Highlight`) used throughout the plugin.

## 3. Design Decisions & Patterns

*   **Centralized Control:** Logic flows primarily from the `MainPlugin` class.
*   **Service Layer:** Functionality is grouped into services (API, Parsing, Rendering) to promote separation of concerns, although the boundaries might evolve.
*   **Modal-based Authentication:** User interaction for login/logout is handled via dedicated Modals.
*   **Configuration via Settings:** Plugin behavior is customized through the standard Obsidian settings tab.
*   **Asynchronous Operations:** Interactions with APIs (Obsidian, Amazon) and file system operations are asynchronous, likely using `async/await`. Error handling for these operations is crucial.

## 4. State Management

*   Plugin settings are managed via `loadData()` and `saveData()` provided by the Obsidian API.
*   Authentication state (e.g., session cookies, login status) needs to be managed, likely within the `KindleApiService` or potentially stored securely using Obsidian's mechanisms if appropriate, although the current plan involves relying on the implicit session maintained by the embedded view context.

## 5. Error Handling

*   Errors during API calls, parsing, or file writing should be caught gracefully.
*   User-facing errors should be reported via Obsidian's `Notice` API.
*   Login failures need specific handling within the `AmazonLoginModal`.
