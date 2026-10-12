# Legacy annotation hold validation — 2026-10-12

## Change

Legacy plain Markdown separated by `---` now exposes the source text correctly for comparison. Location-label removal stays on one line. Raw block bytes and existing proof digests retain their previous meaning.

A unique exact match of annotation kind, normalized text and location takes priority over the conservative legacy fallback. Duplicate exact matches are counted before occupied targets are excluded. Unique anchors, unused targets, competing proposals and whole-note rollback remain required. This also covers standalone and attached memos.

## Software verification

- Parser regressions: RED 3 failures, then GREEN 44 tests.
- Exact correspondence regressions: RED 3 failures, then GREEN 52 tests.
- Independent software review identified occupied memo blocks being excluded too early. Standalone and attached regressions: RED 2 failures, then GREEN 54 tests.
- Final software suite: 330 tests in 23 files passed; TypeScript check and production build passed.
- Deployed `main.js` SHA-256: `2b198213edb84f59585953af4abcb999b37f519129711791a9be435c8f3aa8a2`.

## Private clone verification

Fresh authenticated Amazon input contained 47 held books and 1,595 annotations. The production writer ran against filesystem clones of the backed-up notes, using the four previously approved destinations.

| Measure | Result |
|---|---:|
| Resolved books | 20 |
| Remaining held books | 27 |
| Remaining held annotations | 106 |
| Created notes / appended source annotations / write failures | 0 / 0 / 0 |
| Original note bodies preserved | 242 / 242 |
| Existing `ref-*` anchors / internal links preserved | 2,777 / 42 |
| Existing nonempty properties preserved, excluding sync-controlled fields | 1,917 |
| New repeated anchors / ledger keys / ledger targets | 0 / 0 / 0 |
| Repeat run: byte-identical notes / additions | 242 / 0 |

The 20 resolved books comprise four destination choices and 16 books with unambiguous annotation correspondence. Existing ledger entries increase from 1,172 to 1,556; existing note bodies and references remain intact.

## Actual Amazon and Obsidian verification

The fixed build completed full sync against the authenticated Amazon account and the original Obsidian vault. Library listing was complete: all 257 books were selected and fetched, with zero fetch or write failures, 27 held books, 23 empty books and zero appended annotations. Checkpoints persisted as 207 complete/complete, 27 complete/held and 23 complete/pending.

Of 242 note files, 20 received correspondence-ledger additions and the vault's `updated` timestamp changes; four also refreshed `lastAnnotated`. The other 222 files remained byte-identical. All 242 original bodies, 2,777 old reference anchors, 42 internal links and 1,917 nonempty properties outside the sync-controlled fields were preserved. No files were created or removed, and no repeated anchors, ledger keys or ledger targets were introduced. Live hold keys exactly match the private 27-book / 106-annotation review list.

Normal sync after plugin reload listed all 257 books, selected and fetched 51, and skipped 206 using the persisted checkpoints. Fetch and write failures and appended annotations were all zero. The same 27 books and 106 annotations remained held; all 242 note files were byte-identical to the full-sync result. Reload retained all four approved destination choices and the persisted checkpoints.

Both completed sessions report `partial` because of the retained review holds, rather than a fetch or write failure.

The first live fetch was deliberately interrupted when the independent review found the memo ambiguity. It produced no note-save result, and all 242 notes remained byte-identical to the deployment backup. Its diagnostic reports the unload as a failed session. The fixed build was deployed before starting a fresh full sync.

## Remaining review

The private comparison list covers all 106 unresolved annotations in 27 books: 55 requiring anchor review, 18 with multiple exact matches, and 33 requiring text or kind review. These categories guide manual review; they do not authorize a binding. No unconfirmed helper IDs, bindings or new-source directives were applied. Whole-book holds remain in force.

Original notes, plugin files, settings, authenticated source text, hashes and detailed comparisons are retained locally. Private library titles and source excerpts are excluded from this document and the pull request.
