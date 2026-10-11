# Annotation identity implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Issue #33の識別・安全な旧対応・保存先隔離を実装し検証する。
**Architecture:** Pure note reconciliation with a note-local plugin ledger committed atomically with appended annotations.
**Tech Stack:** TypeScript, Node crypto, Vitest, Obsidian Vault.process.
**Spec:** `docs/superpowers/specs/2026-10-12-annotation-identity.md`

## Global Constraints

- 既存本文・内部リンク・個人メモ・旧アンカー・ファイル名を保持。
- #31 HTML抽出改善、#34保存先UI・設定、mergeは対象外。
- 取得元主キーを保存本文から生成しない。
- 保留時はノート全体を変更しない。

## Review Focus

- 台帳消失／target消失: 回復可能な新規anchorを認識し、欠けた旧targetは保留。
- 同位置・同hashの競合: 一対一対応で勝手に一つを選ばない。
- custom templateがhighlightを重複・省略: 未保存注釈を完了扱いしない。
- 指定パスの消失・ASIN変更: fallbackせず保留／失敗。
- code fence・コメント・CRLF: 偽IDを照合せず既存bytesを保持。

### Task 1: Source identity and reconciliation

**Files:** create `src/services/annotation-identity.ts`, `src/services/annotation-sync.ts` and tests; modify `note-sync.ts`, `models/highlight.ts`, `highlight-parser.ts` and tests.
**Interfaces:** `annotationKey(h: Highlight, asin: string): string`; `reconcileAnnotations(body, highlights, asin, options?): {body, added, warnings, heldAnnotations}`; `AnnotationSyncOptions.bindings` sourceKey→anchor.

- [x] Write regression tests for separate positions, collisions, note-only, legacy ambiguity, explicit bindings, ledger validation and repair. Expected before implementation: assertion failures for old dedup/hold behavior.
- [x] Run `npm test -- src/services/note-sync.test.ts src/services/annotation-sync.test.ts src/services/highlight-parser.test.ts` and inspect RED.
- [x] Implement composite identity, source ID capture and append-only note-local ledger reconciliation.
- [x] Run task tests and suite; expected 0 failures. Commit.

### Task 2: Atomic writer and selected-target boundary

**Files:** modify `src/services/note-writer.ts` and tests, integration tests.
**Interfaces:** optional final `NoteSaveOptions {targetPaths?: Record<string,string>, annotationOptionsByPath?: Record<string, AnnotationSyncOptions>}`; structured `NoteSaveOutcome.heldAnnotations`.

- [x] Write tests for two runs, new annotation, held retry, failure before/after write, selected target isolation, vanished target and template omissions. Run writer tests and inspect RED.
- [x] Use reconciliation for creation and updates; validate rendered targets before saving; attach structured holds and keep snapshot updates after successful IO.
- [x] Run writer tests and suite; expected 0 failures. Commit.

### Task 3: Verification and PR

**Files:** add `docs/issue-33-annotation-identity.md`; update plan checkboxes.
- [x] Review complete diff and regression coverage; run `npm test`, `npx tsc --noEmit --skipLibCheck`, `npm run build`, `git diff --check`. Expected exits 0.
- [x] Document Amazon evidence/limits, mapping recovery steps, #34 interfaces, atomicity and verification. Obtain fresh whole-branch review and resolve substantive findings with RED→GREEN.
- [ ] Push branch, create PR with integration/format/hold details, attach PR. No merge.

## Execution record

- Baseline: 160 tests passed on c08c758. New source regression tests: 9 RED failures, followed by GREEN.
- Source ID capture: RED missing fields, followed by GREEN. Atomic writer regression tests: 7 RED failures, followed by GREEN.
- Source reconciliation and writer tasks complete in 6df3f86 / c725574. Current whole suite: 201 passed (16 files); typecheck/build passed.
- Ruling: annotationOptions is keyed by destination path, preventing manual correspondence from being reused for a different same-ASIN note. Cost if incorrectly scoped: wrong correspondence; tests select A and then hold B.
- Ruling: legacy hash-only edited fixtures require either location evidence or explicit user confirmation. Cost if automatically trusted: omitted colliding annotations; hold/resolve tests cover it.
- Ruling: mappings live in a plugin-managed note-local ledger, rather than a separate plugin data file. This removes two-resource partial commits and preserves mappings on rename. Cost: hidden metadata in note backups/export; documented.
- Fresh reviewer reviewed c08c758..c725574 and reproduced five Important findings. Code examples, open context append, fenced ledger replacement, selected-path ASIN race and mixed invalid ledgers each had RED tests and fixes; whole suite GREEN (201/201). No Critical or deferred Minor findings.
- Author verification also caught custom legacy IDs without location and nonterminal sample IDs; RED→GREEN tests added. Legacy paragraph proof ignores surrounding separators so appending metadata does not invalidate the old block.
- Review excluded live Amazon ID stability (#33 fallback avoids reliance), note-only extraction (#31), #34 UI/settings/integration and live-vault rendering. These are explicitly reported as unverified or deferred scope; merge remains gated on #34 integration.
