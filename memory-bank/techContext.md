# Tech Context: Obsidian Kindle Highlights Sync

## 1. Core Technologies

*   **Language:** TypeScript - Provides static typing for improved code quality and maintainability.
*   **Runtime:** Node.js - Used for dependency management (npm) and build processes.
*   **Framework:** Obsidian Plugin API - Leverages the official API provided by Obsidian for extending its functionality.

## 2. Build & Development Tools

*   **Bundler:** esbuild - Used for fast TypeScript compilation and bundling of the plugin code into `main.js`. Configured via `esbuild.config.mjs`.
*   **Package Manager:** npm - Manages project dependencies listed in `package.json` and `package-lock.json`.
*   **Linter:** ESLint - Enforces code style and identifies potential errors. Configured via `.eslintrc`.
*   **Configuration:**
    *   `tsconfig.json`: Configures TypeScript compiler options.
    *   `.editorconfig`: Helps maintain consistent coding styles across different editors.
    *   `.gitignore`: Specifies intentionally untracked files for Git.

## 3. Key Obsidian API Components Used (Inferred)

Based on the file structure (`src/main.ts`, `src/settings.ts`, `src/modals/AmazonLoginModal.ts`) and common plugin patterns, the following Obsidian API components are likely used or planned:

*   `Plugin`: The base class for the Obsidian plugin (`main.ts`).
*   `PluginSettingTab`, `Setting`: For creating the plugin's settings interface (`settings.ts`).
*   `Modal`: Used for displaying modal windows, specifically the `AmazonLoginModal` for the login process. This modal will likely embed the Amazon login page using an `<iframe>`.
*   `Notice`: For displaying brief notifications to the user (e.g., sync success/failure).
*   `requestUrl`: Potentially used for making HTTP requests to fetch Kindle data after authentication (`services/kindle-api.ts`), although the primary data fetching might involve interacting with the content loaded after login within the Cloud Reader context.
*   Obsidian Commands API: To register commands for triggering sync (e.g., via Command Palette).
*   Ribbon Icon API: To add a ribbon icon for triggering sync.

## 4. Project Structure

*   `src/`: Contains all source code.
    *   `main.ts`: Plugin entry point.
    *   `settings.ts`: Handles plugin settings.
    *   `modals/`: Contains modal component definitions.
    *   `models/`: Defines data structures (e.g., `Book`, `Highlight`).
    *   `services/`: Encapsulates specific functionalities (API interaction, parsing, rendering).
    *   `templates/`: Contains templates for generating Obsidian notes.
*   `manifest.json`: Plugin metadata required by Obsidian.
*   `versions.json`, `version-bump.mjs`: Likely used for managing plugin versioning.

## 5. Dependencies

*   Primary dependency is the `obsidian` API module.
*   Development dependencies include `typescript`, `esbuild`, `@types/node`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint`.
*   No major external runtime libraries are apparent in the current structure, but scraping libraries (like Cheerio) might be considered later for parsing Cloud Reader content if direct API calls are not feasible.

## 6. Technical Constraints & Considerations

*   **Obsidian API Limitations:** Plugin execution is sandboxed within Obsidian's environment. Direct access to certain system resources or complex browser APIs (like full Puppeteer control) might be restricted.
*   **Authentication:** Relies on embedding the Amazon login page within a modal/iframe and capturing cookies/session information upon successful login redirect. This approach is sensitive to changes in Amazon's login flow.
*   **Scraping:** Fetching highlights post-login will likely involve parsing the HTML structure of the Kindle Cloud Reader. This is inherently brittle and may break if Amazon updates the Cloud Reader's UI.
*   **Security:** As noted in the initial request, the established Amazon session (cookies) might be accessible within the Obsidian environment.
