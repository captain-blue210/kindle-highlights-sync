# Kindle Keychain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Amazon sessions and migrate Kindle notes without losing reading annotations.
**Architecture:** Pure metadata and highlight merge functions, an adapter-based session controller, and Obsidian UI/file adapters. Existing ASIN IDs remain internal; saved IDs preserve hadynz compatibility.
**Tech Stack:** TypeScript, Obsidian API >=1.11.4, Electron, Vitest, Nunjucks; yaml parser for lossless frontmatter updates.
**Spec:** docs/superpowers/specs/2026-10-10-kindle-keychain-design.md

## Global Constraints
- Desktop only; secrets only in app.secretStorage; never log cookie data.
- Default names: bookId/title/author/highlights/ASIN/lastAnnotated/image.
- Preserve existing nonempty destination values during migration, bodies and IDs.
- Configure second-brain for co.jp and knowledge/読書ノート.
- PR creation and main merge require final user confirmation.

## Review Focus
- Cookie domains/redirects cannot cross region or vault boundaries.
- Authentication network failures never imply successful empty scraping.
- Metadata-only updates never replace handwritten content.
- Concurrent editing or backup failure never permits unbacked conversion.
- Changed property names and duplicate ASINs cannot create duplicate books.

### Task 1: Metadata migration
**Files:** src/services/note-properties.ts, note-properties.test.ts, property-migration.ts, property-migration.test.ts.
**Interfaces:** PropertyNames, DEFAULT_PROPERTY_NAMES; migrateProperties(content, names, history) -> result; readBookProperties(content, names, history) -> metadata|null; preview/run migration via vault-like adapter.
- [ ] Write tests for legacy nested/flat, custom-name history, collisions, unknown keys, invalid YAML, exact body preservation and repeat conversion.
- [ ] Run tests; expect missing implementation failure.
- [ ] Implement YAML-document update, safe name validation and backup-before-write runner with stale-preview checks.
- [ ] Run tests; expect all pass; commit.

### Task 2: Append-only synchronization
**Files:** src/services/note-sync.ts, note-sync.test.ts, amazon-date.ts, amazon-date.test.ts; main.ts, kindle-api.ts, highlight-parser.ts.
**Interfaces:** kindleHash(text):string; mergeHighlights(body, highlights, asin) -> added/body/warnings; sync note metadata functions; parseAmazonDate(text,region):Date|null.
- [ ] Write tests for existing ref anchors, unanchored text/location, collisions/ambiguity, metadata-only update, English/Japanese dates and >10 successful books.
- [ ] Run and observe failure.
- [ ] Implement ASIN-first matching, stable saved IDs, safe filenames, successful-book filtering and append-only updates.
- [ ] Run tests; expect all pass; commit.

### Task 3: SecretStorage authentication
**Files:** src/services/session-store.ts, amazon-session.ts and tests, src/modals/AmazonLoginModal.ts, kindle-api.ts, utils/remote-loader.ts.
**Interfaces:** session controller ensureAuthenticated(region), persist(region), logout(region), dispose(); injected window/cookie/secret adapters for behavioral tests.
- [ ] Write tests for restoration, expiry, corrupt secrets, region isolation, cancel, network failure, logout and teardown.
- [ ] Observe failures; implement memory partition windows, filtered Cookie JSON secret records and notebook validation.
- [ ] Run suite; expect all pass; commit.

### Task 4: UI, integration and deployment
**Files:** settings.ts, main.ts, locales, migration modal; README.md, manifests/package versions, scripts for reversible deployment/validation.
- [ ] Test custom settings validation, actual note persistence via a stateful vault double, backup failure/stale content, zero-change synchronization and mutexes.
- [ ] Implement preview/result UI and settings controls with Japanese/English copy.
- [ ] Run npm test and npm run build; expect green.
- [ ] Copy 237 private notes to ignored fixture storage; test migration, ID/body preservation, idempotence and backup restoration without committing fixtures.
- [ ] Run whole-branch independent review and fix important findings via RED/GREEN.
- [ ] Deploy verified files, back up configuration, disable old plugin, enable new one, migrate actual notes; verify content/ID equality against backups.
- [ ] Log work to AI journal, provide exact tests and remaining manual-login checks; wait for final user confirmation before PR/merge.
