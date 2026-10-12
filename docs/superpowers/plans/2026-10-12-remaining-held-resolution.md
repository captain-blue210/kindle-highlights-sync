# Remaining Held Resolution Implementation Plan

**Goal:** Implement the approved chat plan for the remaining 27 books / 106 held annotations.
**Spec:** docs/superpowers/specs/2026-10-12-remaining-held-resolution.md
**Execution:** Inline using superpowers:executing-plans; one fresh final reviewer. Reuse the attached worktree on a new branch from current main; create a new PR because PR #42 is merged.

## Constraints and review focus

- Keep raw blocks, proof computation, old IDs, links, filenames and public interfaces unchanged.
- Strip the terminal location label without consuming an earlier in-text dash or colon, including spaced hyphens and LF/CRLF.
- Never write a partial ledger to a held book. Verify unique proof targets against the entire current note and all existing mappings.
- Context proposals are review records, not instructions applied to the vault. Pending confirmation means keep the relevant book held.
- No duplicate-note deletion, ID renaming, unconfirmed binding/new directive, or PR merge. Private data stays outside Git.

### Task 1: Repair terminal location-label projection

**Interfaces:** Existing reconcileAnnotations/mergeHighlights, unchanged raw-body/proof contract.
- [x] Add real-behavior regressions for hyphenated words, spaced hyphens, in-text dashes/colons, nearest terminal delimiter, LF/CRLF and a frozen proof ledger. Expected new cases fail because comparison is truncated.
- [x] Run targeted tests RED, fix only comparison suffix removal, then targeted GREEN, whole suite and production build. Expected preserved original bytes, existing correspondence and zero duplicate additions.
- [x] Commit the tested software fix.

### Task 2: Capture and verify safe proof correspondence

**Interfaces:** Existing authenticated fetch, private filesystem clones and production writer/ledger v1.
- [x] Back up fresh original notes, plugin and settings with hashes; capture the current held books without note writes.
- [x] For the approved 55 cases, recompute kind/text/location identity, raw proof uniqueness and target occupancy from the entire fresh note. Prepare proof entries only in memory.
- [x] Run the production writer on clones with the preview entries. Publish a whole-book result only if all holds resolve and original bodies/IDs/links remain; otherwise discard preview entries and keep the book held.
- [x] Repeat clone synchronization. Expected zero failures, only expected ledger/metadata changes and no duplicate append; preserve evidence outside Git.

### Task 3: Prepare context proposals and apply confirmed results

**Interfaces:** Actual source annotations, current raw note blocks, ledger v1/explicit existing anchor binding.
- [x] Examine surrounding highlight/memo paragraphs for all remaining 45 cases. Record source, candidates, context, recommended target, alternatives, exact reason and unresolved uncertainty in private Markdown/JSON.
- [x] For indistinguishable duplicates, propose the first original-order candidate while retaining every copy. Request bundled user confirmation against this concrete record.
- [x] Apply only user-confirmed proposals after clone verification. Use existing unique anchor or unique proof; introduce a helper ID only if required and explicitly included in the confirmed proposal. A new-source directive requires confirmation of no existing saved block.
- [x] If confirmation remains pending, keep these results unmodified and continue the independent 61-case rollout; report the approval boundary clearly.

### Task 4: Live validation, review and delivery

**Interfaces:** Existing Obsidian plugin commands and identity checks, backups, public aggregate evidence, AI journal.
- [x] Obtain one fresh software review before deployment; fix Important/Critical findings in one RED→GREEN pass with a green suite.
- [x] Deploy verified artifacts and only fully resolved, approved whole-book ledgers through an atomic current-content check. Keep unrelated vault content and settings intact.
- [x] Run actual full sync, snapshot/verify original bodies, then reload and run normal sync. Expected complete listing, zero fetch/write failures, held keys consistent with approval state and no unexpected additions/repeated IDs/ledger targets.
- [ ] Persist private evidence, restore temporary runtime changes, write aggregate public validation, create/attach a reviewable PR and append the canonical AI journal. Keep the PR worktree for feedback.
