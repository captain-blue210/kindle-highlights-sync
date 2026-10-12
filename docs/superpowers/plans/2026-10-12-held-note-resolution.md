# Held Note Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduce safe-to-resolve legacy holds without regenerating saved note bodies.
**Architecture:** Fix only the comparison projection, prefer unique exact text/location candidates, retain all ledger and whole-note safety gates. Use private captured Amazon data and real filesystem clones before deployment.
**Tech Stack:** TypeScript, Vitest, Obsidian/Electron, Node, esbuild.
**Spec:** docs/superpowers/specs/2026-10-12-held-note-resolution.md

## Global Constraints

- Keep original bodies, user edits, personal memos, old IDs, filenames, and existing proof digest compatibility.
- No new public APIs, ledger version, review UI, or dependencies.
- Keep held books pending; no partially advanced ledgers.
- Only the four user-selected destinations may be selected; no other bind/new/helper-ID decisions are authorized.
- Private source text and review records stay outside Git. Implementation is authorized; another PR merge is not part of this request.

## Review Focus

- Plain Markdown separators and multiline source text must not be consumed as link labels.
- Existing proof-ledger bytes must still identify the original raw block.
- A duplicated exact target must not become safe after filtering an occupied target.
- Note-only/attached memos must retain kind isolation and personal-note protection.
- Vault edits between preview and save must not be overwritten by private validation or destination selection.

### Task 1: Repair legacy comparison text

**Files:** src/services/annotation-sync.ts; src/services/annotation-sync.test.ts
**Interfaces:** Consumes reconcileAnnotations(body, highlights, asin, options). Produces the same signature and raw-body/proof contract.

- [x] Write regressions for separator-prefixed text, multiline link labels, LF/CRLF and old plain proof ledgers. Expected zero additions, preserved raw body and correct stable correspondence.
- [x] Run `npm test -- src/services/annotation-sync.test.ts`; expected new behavior tests fail while baseline tests remain passing.
- [x] Fix plain text projection without changing raw block bytes/proof calculation; prevent suffix stripping across lines.
- [x] Run the targeted tests; expected all pass. Commit `fix: preserve legacy text in annotation comparison`.

### Task 2: Prefer unique exact correspondence

**Files:** src/services/annotation-sync.ts; src/services/annotation-sync.test.ts
**Interfaces:** Consumes Task 1 comparison text. Produces unchanged ledger entries and heldAnnotations types.

- [x] Write regressions for distinct texts at one location, duplicate exact matches, occupied targets, duplicate anchors and memo isolation. Expected existing IDs retained, no new duplicates and whole-note hold for ambiguity.
- [x] Run the targeted suite; expected exact unique matches currently hold.
- [x] Prefer a unique exact text/location candidate before legacy fallback; require safe unoccupied unique anchors, preserve existing fallback/competition rules.
- [x] Run `npm test` and `npm run build`; expected green. Commit `fix: prefer unique exact legacy annotation matches`.

### Task 3: Validate clone and actual vault

**Files:** private validation scripts and records under /private/tmp/kindle-held-resolution-20261012; docs/held-note-resolution-validation.md
**Interfaces:** Consumes actual books/highlights and existing saveBookNotes, app destination selection, plugin commands.

- [x] Back up current reading notes, plugin and settings with verified hashes; capture the held books' actual Amazon annotations without note writes.
- [x] Run the production writer on filesystem clones using approved target paths; expected raw original bodies/properties/old IDs retained except permitted metadata and ledger additions, no failed writes. Repeat with same input; expected byte-identical output and added=0.
- [x] Deploy verified artifacts, select four actual destinations through existing identity checks, execute full sync then reload plugin and execute normal sync. Expected list complete, no new failures or duplicated annotations, unresolved holds retained.
- [x] Generate private Markdown/JSON comparison records containing current source text/location and candidate blocks for every remaining hold. Apply no unconfirmed resolution.
- [x] Record results and limits, commit public validation documentation with no private text.

### Task 4: Review and deliver

**Files:** branch documentation and AI journal
**Interfaces:** Consumes completed branch and private verification evidence.

- [x] Request one independent whole-branch review, address important findings with RED→GREEN verification, and recheck the relevant suite.
- [ ] Push the completed work on its feature branch and create/attach a reviewable PR. Do not merge a new PR without user authorization.
- [ ] Append the canonical daily AI journal entry and report resolved/remaining counts plus private review list and backups.
