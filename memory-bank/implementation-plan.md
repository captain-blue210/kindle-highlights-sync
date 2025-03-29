# Implementation Plan: Amazon Cloud Reader Login Feature (2025-03-29)

## Goal

Enable users to log into their Amazon account within Obsidian and utilize that session to synchronize Kindle highlights.

## Key Components

*   **`AmazonLoginModal`**: Modal embedding the Amazon login page via `iframe` and handling authentication.
*   **`AmazonLogoutModal`**: Modal or prompt for handling logout.
*   **`KindleApiService`**: Service managing login state, communication with Amazon (login, data fetching).
*   **`SettingsTab`**: UI for Amazon region selection.

## Steps

1.  **Preparation:**
    *   Add Amazon region setting (`com`, `co.jp`, etc.) to `settings.ts`.
    *   Define region-specific login and Cloud Reader URLs (e.g., in `KindleApiService`).

2.  **`AmazonLoginModal` Implementation (`src/modals/AmazonLoginModal.ts`):**
    *   Inherit from Obsidian `Modal`.
    *   `onOpen()`: Create `iframe`, add to `contentEl`, set `src` to region-specific login URL.
    *   Add CSS for `iframe` sizing.
    *   `onClose()`: Clean up resources.

3.  **Login Success Detection (`AmazonLoginModal`):**
    *   Monitor `iframe` `load` event.
    *   In handler, check `iframe.contentWindow.location.href` against region-specific Cloud Reader base URL.
        *   **Risk:** Cross-origin restrictions might block access. Investigate alternatives if needed (e.g., indirect monitoring, manual confirmation).
    *   On success: Close modal, notify caller (Promise/callback).
    *   On failure: Notify caller/show error.

4.  **Session Management (`KindleApiService`):**
    *   Receive login success notification, update internal state flag.
    *   **Hypothesis/Verification:** Assume/verify that `requestUrl` automatically uses cookies set in the `iframe` for same-domain requests.
    *   Provide `isLoggedIn()` method.

5.  **`AmazonLogoutModal` & Logout Logic (New):**
    *   Create simple confirmation modal (`AmazonLogoutModal`).
    *   On logout execution:
        *   **Strategy 1 (Preferred):** Navigate an `iframe` (visible or hidden) to the Amazon logout URL to attempt cookie clearing.
        *   **Strategy 2 (Fallback):** If Strategy 1 fails, reset internal plugin state only and inform the user (actual Amazon session might persist).
    *   Update `KindleApiService` internal state.

6.  **Plugin Integration (`main.ts`, `KindleApiService`):**
    *   Add login/logout commands and ribbon icons.
    *   On sync command: Check `KindleApiService.isLoggedIn()`.
    *   If not logged in: Show `AmazonLoginModal`.
    *   If logged in: Proceed with data fetching via `KindleApiService`.
    *   Implement `login()`, `logout()`, `fetchHighlights()` interfaces in `KindleApiService`. `login()` triggers `AmazonLoginModal`.

7.  **Data Fetching (`KindleApiService`):**
    *   Implement logic to fetch highlights from Cloud Reader using the established session (expecting `requestUrl` to use cookies). This likely involves scraping or interacting with Cloud Reader's internal APIs.

8.  **Error Handling & Testing:**
    *   Implement robust error handling for all stages (login, logout, fetch).
    *   Use `Notice` for user feedback.
    *   Test thoroughly across regions, 2FA, failures, etc.

## Flow Diagram

```mermaid
graph TD
    A[User starts Sync/Login] --> B{Logged In?};
    B -- No --> C[Show AmazonLoginModal];
    B -- Yes --> D[Proceed to Fetch Highlights (KindleApiService)];

    subgraph AmazonLoginModal
        C --> E[Create iframe];
        E --> F[Load Amazon Login URL (by region)];
        F --> G{Monitor iframe Navigation};
        G -- Login Page Loaded --> G;
        G -- Redirect to Cloud Reader URL? --> H{Login Success?};
        H -- Yes --> I[Notify Success & Close];
        H -- No (Error/Timeout/Other URL) --> J[Notify Failure & Close / Show Error];
    end

    I --> K[Update Plugin Login State];
    J --> L[Show Error Notice];
    K --> D;

    M[User starts Logout] --> N[Show AmazonLogoutModal (Confirm)];
    N --> O{Attempt Logout};

    subgraph Logout Logic
        O --> P[Navigate iframe to Logout URL];
        P --> Q{Clear Internal Login State};
        %% Consider fallback if P fails
    end
    Q --> R[Show Logout Confirmation Notice];

    D --> S[KindleApiService uses Session Cookies];
    S --> T[Fetch Data from Cloud Reader];
    T --> U[Parse & Save Highlights];
```

## Key Risks & Considerations

*   **Cross-Origin Restrictions:** Accessing `iframe.contentWindow.location` might be blocked.
*   **Cookie Access/Usage:** Relying on `requestUrl` to automatically use `iframe`-set cookies needs verification.
*   **Logout Reliability:** Clearing cookies effectively via `iframe` navigation is uncertain.
*   **Scraping Brittleness:** Data fetching logic might break if Amazon changes the Cloud Reader UI.
