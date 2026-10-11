# Issue #33: 注釈の同一性とノート単位の対応情報

起点: main `c08c758`。目的は取得元の注釈と保存本文を分離し、手編集・リンク・旧アンカー・ファイル名を保持すること。#34の保存先選択と#31のメモ抽出は含めない。

## 識別

Amazon公開NotebookスクリプトにはDOMの注釈IDとhighlight/note操作用IDがある。ただし複数取得間の安定性は未確認なので、今回の主キーには使わない。parserは取得できたAmazon IDを診断用の別フィールドに保持する。主キーはバージョン・ASIN・正規化位置・注釈種別・取得元本文のSHA-256。highlightに付随するnoteは主キーに含めない。メモだけの注釈はnote本文を使う。同本文同位置は重複排除し、別位置・種別・本文は別とする。保存本文から主キーを作らない。

## 対応と永続化

プラグイン管理の `<!-- kindle-sync:v1 BASE64_JSON -->` 台帳を保存先ノート内に置く。JSONはversion、asin、sourceKey→targetのentries。targetは既存のblock anchor、または旧未アンカーblockの照合証拠。新規注釈には `^ks-<SHA256>` を生成し、旧 `^ref-*` はそのまま保持する。旧本文の照合証拠は移行時の確認にだけ使用し、保存後の注釈主キーには使わない。未アンカーの旧本文が変更され証拠が失われた場合は保留する。

ノート本文と台帳を一回のcreate/processで保存する。別のプラグインデータファイルへの保存は設けず、二つの永続化先の片成功を構造的に除く。新規anchorは台帳が失われても回復可能。台帳だけ残りtargetがなくなった場合は保留する。破損・未知バージョン・ASIN相違も保留する。失敗したsaveのローカルsnapshotを成功扱いにしない。

## 旧注釈と保留

初回は旧anchor＋位置＋取得元本文の旧hash、または位置＋正規化本文の一意対応で照合する。同hash別本文・同本文別位置を含め、remoteとlegacyの一対一対応を確認する。位置なしhashだけの編集本文、同位置の編集済み未アンカー本文、重複anchorは自動対応しない。保留時はノート全体を変更せず `heldAnnotations: {sourceKey, reason, candidates}[]` を返す。

明示対応は `AnnotationSyncOptions.bindings`（writerでは保存先パス別の `annotationOptionsByPath`） またはノートに追記する `<!-- kindle-sync-bind: SOURCE_KEY ^ANCHOR -->`。利用者が対象blockを確認してanchorを指定し、sourceKey・存在する一意anchor・一対一制約を検証した後の再同期で台帳に記録する。旧未アンカーの場合は利用者が自分でblock IDを付けてから明示対応できる。保留中は台帳も本文も書かない。まだ保存していない注釈の明示確認は `newSourceKeys` または `<!-- kindle-sync-new: SOURCE_KEY -->`。コード例、行途中のID、閉じていないMarkdown文脈は保存済みtargetとして認識しない。台帳更新は実台帳の元の位置だけを変更する。

## #34境界

`syncNoteContent(current, book, highlights, names, history, options?)` が選択済みノートの純粋merge境界。`saveBookNotes`の末尾optional引数 `NoteSaveOptions.targetPaths` はASIN→選択済みパスを受ける。存在しない／ASIN不一致の指定は別ノートへfallbackしない。選択UI・永続設定は#34。台帳は各ノート内だけで使用するので、同ASINの別ノートに対応を流用しない。

## 検証

同本文別位置、実際のFletcher16衝突、複数note-only、編集済み旧本文・リンク・アンカー・改名、曖昧対応と明示解決、連続2回、新規追加、保留後・write例外前後の再実行、選択先隔離、破損台帳、台帳消失、target消失、code fence内の偽ID、CRLF、custom templateを回帰テストに含める。実ノートを変更しない。全suite・型チェック・production build後にPRを作り、#34統合前はmergeしない。
