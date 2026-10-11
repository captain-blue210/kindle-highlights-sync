# Issue #33: 注釈識別・保存形式・#34との接続

## 取得元の識別

基点はmain `c08c758`。最新Issue #33/#34の本文を2026-10-12に確認した。

主キーは `s1-<SHA-256>`。ハッシュ対象はJSON配列 `[1, ASIN, 正規化位置, highlightまたはnote, 正規化した取得元本文のSHA-256]`。空白を正規化し、大文字小文字は保持する。位置は末尾数字の先頭ゼロを除去する。位置がないときは取得元の位置文字列または空文字列を使う。highlightの付随メモは主キーに含めない。メモだけの注釈はメモ本文を使う。同本文・同位置・同種別は一件、別位置・別本文・別種別は別注釈。

`Highlight.id` は既存parserが生成した値なのでAmazon IDとして扱わない。日本のNotebookで使うAmazon[公開配信JavaScript](https://m.media-amazon.com/images/S/sash/q0N4m9rh8DW3T9s.js)を実行せず調査した。取得ファイルSHA-256は `3e1bf35eb64d12bd9839599cb934c29e470f697768de8eb1b0344f77df507ca8`。

- `createPopoverContent` / `buildOptionsList` はannotation DOM要素のIDを使用する。
- `getHighlightId` は `.kp-notebook-highlight` のIDを読む。
- 削除・追加メモ等の操作はIDの一部を `highlightId` として送信する。
- `handleReadMore` は注釈IDからDOMを選び、`#kp-annotation-location` を読む。

これによりIDの存在と用途は確認できた。ただし同一アカウント・同一注釈を再取得した際のID安定性、note-only IDの形状・挙動は実画面で未確認。主キーとして採用せず、取得できたDOM IDを `sourceAnnotationId` / `sourceHighlightId` に保存する。#31のnote-only HTML抽出改善はこの変更に含めない。識別・保存はすでに `text: "", note: "…"` を受け入れる。

## ノート内の対応台帳

プラグインが管理する一つのHTMLコメントをノート本文末尾に置く。

```text
<!-- kindle-sync:v1 BASE64_ENCODED_JSON -->
```

デコードしたJSONの型:

```ts
{
  version: 1;
  asin: string;
  entries: Record<string, {anchor: string} | {proof: string}>;
}
```

sourceKeyは `s1-<64桁hex>`、anchorは `^` を除いたblock ID。新規注釈は `^ks-<64桁hex>`、旧 `^ref-*` と他の既存block IDは変更しない。proofは未アンカー旧blockの照合証拠（SHA-256）。proofは表示本文の変更を検知し安全に保留するためだけに使い、注釈の主キーを再生成する材料にはしない。

初回照合は一意な「旧hash＋位置」または「取得元本文＋位置」を使う。位置なしの旧hashだけで編集済み本文を同一と決めない。同hash／同位置に複数候補がある場合も保留する。旧本文・アンカー・内部リンク・個人メモを書き換えず、対応台帳と新規注釈だけを追加する。

対応は保存先ノートの台帳だけから読む。別ノートへの対応キャッシュやASIN単位のグローバル台帳はない。ノートを改名しても台帳が付いて移動する。本文と台帳は一つの `io.create` / `io.process` で保存するため、別ファイルとの片成功を設けない。書き込み結果が不明な例外でも、再実行時にノートを読み直して対応を復元する。新規block IDは台帳が失われても再認識できる。台帳があるのにtargetが消えた場合は勝手に重複を追加せず保留する。未知バージョン・別ASIN・破損・重複台帳も保留する。

## 保留の解決

`NoteSaveOutcome.heldAnnotations` は次の形式。台帳全体の不正など書籍単位の保留ではsourceKeyは空文字列。

```ts
{
  sourceKey: string;
  reason: "ambiguous-legacy" | "missing-target" | "invalid-ledger" | "invalid-binding";
  candidates: string[]; // block ID、または block:<SHA256証拠>
}[]
```

保留時にはプロパティを含めてノートを変更しない。候補は利用者への確認材料であり、自動選択の承認ではない。現在の保存結果は `app.plugins.plugins["kindle-highlights-sync"].lastSyncResult.outcomes` でも確認できる。

実ノートを扱う場合は先に複製で確認する。取得元注釈と既存blockを本人が照合した後、そのノートに次のコメントを追記し再同期する（`SOURCE_KEY` と `BLOCK_ID` を保留結果／確認した既存IDに置き換える）。

```text
<!-- kindle-sync-bind: SOURCE_KEY ^BLOCK_ID -->
```

旧未アンカーblockが変更されproofが一致しなくなった場合は、そのblockに本人が一意なblock IDを付け、このコメントで再対応付けできる。既存targetが正常にある対応を別blockへ勝手に移す指定、存在しないID、複数blockで同じID、一つのtargetへの複数sourceは保留する。

衝突候補に見えても、本人が「この注釈はまだ保存されていない」と確認した場合は次のコメントで新規追加を明示できる。

```text
<!-- kindle-sync-new: SOURCE_KEY -->
```

同じsourceKeyへのbindとnewの同時指定は無効。コメントはsourceKeyごとの指示としてノートに残り、再実行は台帳で重複排除する。アンカーを消した注釈を戻す場合は既存blockに一意IDを戻してbindする。破損台帳を手で削除する場合、旧未アンカー対応は再確認が必要になるため、バックアップしてから行う。

## #34との接続

選択済みノートを直接処理する純粋関数:

```ts
syncNoteContent(current, book, highlights, names, history, annotationOptions?)
// => {content, added, warnings, heldAnnotations}
```

writerへの接続（既存の進捗callback位置は保持）:

```ts
saveBookNotes(io, settings, books, highlights, onBook, onBookSettled, {
  targetPaths: { [asin]: selectedPath },
  annotationOptionsByPath: {
    [selectedPath]: { bindings: { [sourceKey]: blockId }, newSourceKeys: [] }
  }
})
```

`targetPaths` に指定したパスは通常の保存先スキャン範囲内の既存ノートで、ASINが一致する必要がある。消失・不一致の場合は他候補へfallbackしない。処理中にも最新プロパティを確認する。選択UI・指定先の永続設定・消失時の再選択は#34側で扱う。`annotationOptionsByPath` も保存先ごとの確認を受けた場合だけ渡す。同じASINの別ノートへの操作に前のパスのbindingsを移さない。

新規ノートのカスタムテンプレートは各注釈の可視block IDを一度ずつ含める必要がある。省略、二重展開、code fence内だけの展開は保留。新規注釈はbodyに存在して初めて対応台帳に記録する。

## 検証と限界

- 回帰テスト: 同本文・同位置の重複、同本文・別位置、実際のFletcher16衝突 `aca` / `bab`（ともに19494）、複数note-only、編集された本文と内部リンク、旧／custom block ID、ファイル改名、CRLF。
- 連続2回同期、新規追加、曖昧保留→bind/new→再同期、未アンカー移行後の編集→再対応付け、create/processの保存前／保存後例外→再実行を検証。
- 選択先だけ更新、別同ASINノートの全文・プロパティ保持、選択先消失／ASIN相違、台帳破損／消失／target消失、カスタムテンプレート省略／重複を検証。
- 実ノートの変更・実アカウントの注釈変更・プラグインの実vault配布は行っていない。Amazon IDの時系列安定性、#31抽出改善、#34のUI・設定との統合は未確認。
- PRは#34との統合検証までmergeしない。

## 最終確認（2026-10-12）

- `npm test`: 16ファイル、201テスト通過（初期mainは160テスト）。
- `npx tsc --noEmit --skipLibCheck`: exit 0。
- `npm run build`: exit 0（型チェックを含むproduction build）。
- `git diff --check`: exit 0。
- 独立レビューのImportant 5件を再現テストでRED→GREENにした。コード例中のID、未閉鎖のフェンス／HTMLコメント、実台帳の前の台帳サンプル、指定先の保存直前ASIN削除、未知／不正台帳の混在を修正。Critical指摘・未修正Minor指摘はなし。
- ノート内台帳を採用した設計判断と、保存先パス別の手動対応オプションはspec/planに記録。前者の利用上の差はノートのバックアップ／exportにプラグイン用コメントが含まれること。
