# Explicit sync destinations implementation plan

> Use superpowers:executing-plans for inline execution. The user requested implementation, validation and PR creation; proceed within that scope.

**Goal:** Complete Issue #34 without modifying unselected notes.
**Architecture:** A pure destination resolver returns snapshots or structured holds; existing annotation saving consumes the snapshot. Plugin settings persist explicit selections; modal and vault events manage selection validity.
**Tech Stack:** TypeScript, Obsidian, Vitest.
**Spec:** docs/superpowers/specs/2026-10-12-sync-destination-design.md

## Global constraints
Preserve existing text, links, memos, anchors, filenames. Do not merge/delete notes. Do not change annotation identity (#33). No real-vault deployment or merge.

## Review focus
Path reuse, missed rename events, folder rename/delete, in-flight ASIN removal, failed selection persistence.

### Task 1: Resolver and writer
Files: services/note-destination.ts, note-writer.ts, vault-io.ts and tests.
Produces: NoteDestination/NoteDestinations; resolveNoteDestination returns existing/new/held; scanNoteDestinations returns UI groups. Retain syncNoteContent unchanged.
- [x] Write writer integration tests for holds, candidate paths, selection, lost/changed/replaced target, unrelated note preservation, repeat saves and resume; run RED.
- [x] Implement resolver, IO identity pins and writer holds; run relevant tests GREEN.

### Task 2: Persistent settings and selection UI
Files: main.ts, settings.ts, modals/NoteDestinationModal.ts, locales and tests.
Consumes: resolver types and scan; produces persisted noteDestinations.
- [x] Write reload, confirmation, failure, event invalidation, stale preview, DOM tests; run RED.
- [x] Implement command/settings entry point, validation and persistence, event invalidation, localized modal; run relevant tests GREEN.

### Task 3: Verification and PR
- [ ] Run full npm test, npx tsc --noEmit --skipLibCheck, npm run build and git diff --check.
- [ ] Review whole diff and requirement matrix; fix meaningful findings with regression tests.
- [ ] Commit, push feature branch, create and attach PR with interface, storage, held-outcome formats and #33 integration limitation. Do not merge.
