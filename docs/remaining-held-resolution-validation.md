# Remaining hold resolution validation — 2026-10-12

## Software

Terminal location-caption extraction retains source hyphens, spaced hyphens, dashes and colons. LF/CRLF, adjacent ASCII/en/em-dash separators and hyphenated caption names are covered. Raw annotation blocks, proof computation, public interfaces and ledger v1 remain unchanged.

The regressions failed before the corresponding fixes. The final suite passes 332 tests in 23 files; TypeScript verification and the production build pass. One independent review identified three Important issues: adjacent ASCII captions, safe-first/confirmed-later replay, and approval binding to actual generated packet bytes. All were fixed in one RED→GREEN pass. Seven private rollout-gate tests pass, including stale proposal rejection, changed packet rejection, completed safe receipt handling and atomic drift rejection.

## Fresh source and clones

Authenticated Amazon input contains 27 held books and 1,211 source annotations, with complete library listing and zero fetch failures. Fresh original notes, plugin files and settings are backed up with hashes.

The approved 55 cases have unique kind/text/location correspondence, unique raw block proofs and no occupied targets. Their proof entries are prepared in memory, then the production engine must fully resolve the book before any whole-note result is eligible for rollout. This resolves one book with 656 ledger entries; 26 books / 45 annotations remain held.

Safe clone verification preserves all 242 original bodies, 2,777 old `ref-*` anchors, 42 internal links and 1,917 nonempty properties outside sync-controlled fields. No notes or source annotations are added, no writes fail and no duplicate anchors/ledger keys/targets are introduced. The repeat clone is byte-identical across all 242 files.

## Bundled confirmation proposals

Private context records cover 18 duplicate exact highlights, five edited wiki-link displays and 22 unmarked memos. Duplicate exact highlights propose the first original-order block while retaining both copies. All memo recommendations match the preceding source position and, for attached memos, the parent highlight text or legacy hash.

The proposed routes are 23 existing unique anchors, 14 existing unique proofs and eight new helper IDs on unmarked memo paragraphs. No new-source directive is proposed. Applying all proposals to clones resolves all 27 books with zero held books, failures, created notes or appended source annotations; repeating produces 242 byte-identical files. For original-byte preservation, a separate comparison-only copy removes precisely the eight proposed helper-ID lines. Every other original body byte, old reference and internal link is preserved; the actual proposed files are kept unchanged.

The 45 proposals require matched human confirmation before live application. Generated packets carry source, proposal and content hashes; confirmation must bind the exact ready-packet bytes. Completed safe receipts bind the safe packet and path set, permitting a later confirmed rollout without replaying an already-applied note. Unrecognized drift fails preflight or the atomic callback.

## Actual Obsidian rollout

The safe-only packet was applied with original-content checks before and inside `vault.process`. All 242 original bodies, 2,777 old references and 42 internal links remain intact. All 2,725 previously cached Obsidian block IDs remain recognized. No unconfirmed proposal or helper ID has been applied.

Actual full sync listed and fetched all 257 books, with zero fetch/write failures, created notes or appended source annotations. The safe book resolved successfully. There were 26 correspondence holds / 45 annotations and 23 empty books. Four previously selected destinations additionally reported filesystem identity changes, giving a temporary total of 30 held books. Their paths, ASINs and complete bodies were verified against the previously successful snapshot, then the same authorized choices were reselected through the existing identity checks. No destination note content was changed. Plugin reload retained all four valid choices.

All 242 original bodies, old references, links and nonempty properties outside sync-controlled fields were preserved; one file received the expected ledger addition and timestamp update. Normal sync after plugin reload listed all 257 books, fetched 54 and skipped 203. There were zero fetch/write failures, created notes or appended source annotations, and the same 26 correspondence holds / 45 source keys remained. All 242 files were byte-identical to the full-sync snapshot. Checkpoints are 208 complete/complete, 26 complete/held and 23 complete/pending. The refreshed four destination records remained unchanged, and all 2,725 previously cached IDs remain recognized.

The final live hold keys exactly match the private confirmation list. Its 45 proposals and eight helper IDs remain unapplied. The normal session's `partial` status reflects those review holds. The deployed `main.js` SHA-256 is `c41010f8dbbdd0fd1efb0f87c1b0038dbcfd3ab0d597220a418c61bf37e003b7`.

Private source excerpts, library titles, exact correspondence records and backups stay outside Git. This document contains aggregate evidence only.
