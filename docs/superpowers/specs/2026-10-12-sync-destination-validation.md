# Issue #34 verification and #33 handoff

Base: origin/main c08c758. Feature: codex/issue-34-sync-destination.

## Verified

`npm test`: 208 passed, 18 files. `npx tsc --noEmit --skipLibCheck`: exit 0. `npm run build`: exit 0. `git diff --check`: exit 0.

| Requirement | Authoritative automated evidence |
| --- | --- |
| Display all same-ASIN paths and choose exactly one | NoteDestinationModal DOM tests; resolver test includes an ASIN-only note with missing bookId/title |
| Unselected duplicates are held, never completed | writer test asserts held=1, failed=0, no updated/created/added; completion callback is held; exact candidates |
| Persist choice and reuse after reload | main select/reload test, loader validation tests, writer explicit-selection precedence |
| Only chosen note updated; retain body, links, memos, anchors, filenames | writer two-consecutive-save test asserts old body prefix and exact unselected string (frontmatter and body), exact paths |
| Missing/ASIN-changed/removed/replaced target requires reselection | writer hold reasons and persisted tombstone after original path returns; selected file disappearing in scan and atomic process |
| Rename/delete cannot switch to a remaining note | registration test fires actual installed vault handlers; folder descendants; resolver tombstone reload; real Vault IO rejects same-path/same-ctime different TFile |
| Two consecutive syncs and resume after hold | writer adds once, second adds zero, complete content equality; hold then select and rerun |
| Failed settings save cannot enable selection | main rollback test and queue-race regression with another ASIN invalidation; successful selections retained by queued settings saves; pending rename persisted |
| Return held reasons to diagnostics/result | NoteSaveOutcome reason/candidates; writer completion callbacks; main partial progress counts and diagnostic noteSave assertions |
| Separation from #33 | note-destination returns snapshots; writer keeps syncNoteContent/renderHighlight unchanged; note-sync changes only optional snapshot ctime |

## Independent review

Reviewer examined c08c758..d8aa08b read-only. Two Important findings, no Critical findings; both addressed with tests that failed before fixes:

1. Provisional selection leaked into another queued save after first save failed. Selections now commit only after persistence succeeds; ordinary queued snapshots merge current committed destinations; pending invalidation is tracked separately.
2. ASIN-only notes were omitted because discovery depended on bookId/title. `readNoteAsin` now reads only ASIN properties, independently of complete book metadata. Both candidate discovery and explicit selected save are covered.

Additional scan-disappearance regression was RED→GREEN. Full suite/typecheck/build above run after these changes. No second independent review run was performed. No declined-to-judge items or deferred minor findings.

## #33 connection

`resolveNoteDestination` returns existing note snapshot (path/content/optional ctime/fileId), new, or held (stable reason, candidates, optional selectedPath). Existing notes go through atomic io.process; its current content is passed to syncNoteContent. Plug annotation correspondence lookup/append into that call without reintroducing independent destination lookup. Validate correspondence against the selected destination when switching to another candidate.

Plugin data.json stores noteDestinations[asin] = {path, ctime, fileId, invalidated?}. NoteWriterIO.identity returns creation time; createVaultIO pins file objects. Writer invalidation updates this table; main persists changes before treating sync as finished. Held outcomes include asin/status=held/reason/candidates and optional path; completion callbacks remain held. Annotation IDs, old anchor matching and new-annotation rendering are #33's responsibility.

## Unverified and merge gates

Real Obsidian/Japanese Notebook execution and live filesystem event ordering were not exercised. No real notes were modified or deployed; tests use synthetic vaults, DOM, real temporary filesystem notes, and real resolver/writer/Vault IO code with simulated Obsidian vault APIs. If real-note validation is performed, use a copied vault first.

Persisted identity also includes device/inode/birthtimeNs. Real temporary-filesystem tests verify that an offline replacement preserving path, ASIN and Obsidian ctime is held, and ordinary writes keep this identity over two consecutive saves. A copied/restored vault or external editor that replaces the inode requires reselection; do not guess a new identity.

Merge only after combining with #33 and checking separate positions for identical text, old hash collisions/anchors, note-only annotations, switching chosen destination with existing correspondence, repeated sync and resume after hold. This PR does not merge or cherry-pick #33.

Final safety refinement: persisted `fileId` now prevents equal-ctime offline replacement. Resolver regression was RED→GREEN; native IO tests use actual temporary filesystem notes, verify distinct file IDs after replacement, exact unselected file bytes, and identity/content preservation over two consecutive syncs. Legacy selections without this field are invalidated on load. No new dependency or note marker was added.

Delivered as draft PR #38: https://github.com/captain-blue210/kindle-highlights-sync/pull/38. PR is open against main; no merge performed. GitHub reported no status checks; verification above is local.
