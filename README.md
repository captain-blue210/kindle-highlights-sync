# Kindle Highlights Sync for Obsidian

Obsidianでkindle highlightsを読み込むプラグインです。

## 特徴

- Kindle Cloud Readerからハイライトをスクレイピング
- ノートを作成するディレクトリを指定可能
- ハイライト/書籍情報のカスタムテンプレート機能
- Amazonのリージョン設定
- 書籍メタデータのダウンロード設定
- コマンドからの同期実行

## Keychain and existing Kindle notes

Requires desktop Obsidian 1.11.4 or newer. Amazon session cookies are saved in Obsidian Keychain (`app.secretStorage`); email and password are never saved. Normal plugin settings contain only secret references. Sessions are isolated by vault and Amazon region. Use **Sign in / verify connection** in settings to authenticate, and **Logout from Kindle** to remove the current region's saved and running session. Keychain storage follows Obsidian's own vault storage behavior; this plugin does not claim additional encryption.

The plugin reads both hadynz `kindle-*` properties and the older `kindle-sync` object. Its default properties are `bookId`, `title`, `author`, `highlights`, `ASIN`, `lastAnnotated`, and `image`. Configure these names in settings; previous names remain recognized. Run **Convert Kindle properties** from settings or the command palette to review paths, changes, and conflicting values before applying. Existing nonempty values take precedence. Invalid YAML and unidentified notes are skipped.

Conversion backs up the original notes under `.obsidian/plugins/kindle-highlights-sync/backups/<timestamp>/`, retaining their vault-relative paths. To restore, stop synchronization and copy those originals back to the corresponding paths. Conversion preserves the Markdown body, tags, unrelated properties, filenames, and existing IDs. Unknown nested fields remain. Repeating conversion adds no changes.

Synchronization matches ASIN first, retains stored IDs and filenames, recognizes hadynz `^ref-*` anchors, and appends new highlights after existing content. Ambiguous unanchored highlights are held for review. A successful fetch also updates highlight count and valid annotation date when no new highlights are found. Invalid dates are left untouched instead of replaced with the current time. Failed books are excluded from note updates; partial results are reported.

After conversion these notes are managed by this plugin. To synchronize them with the hadynz plugin again, restore its `kindle-*` property names first. Keep the hadynz plugin disabled while this plugin is active.

## Sync progress and errors

The sync dialog uses a centered animation, current phase and full book title, a slim progress bar, and compact completed/total, failed and review counts. The scrollable activity log records phase and book outcomes with elapsed intervals; its latest 250 entries can be copied. Fetching and saving are reported separately, including notes that need no changes. Closing the dialog allows sync and logging to continue. The bar counts processed books including failures and review holds; reaching 100% with issues is reported as a partial result. Books that need no changes count as completed. Results remain visible until closed.

Settings retain the latest problematic sync, connection or logout operation with safe error details across restarts. Successful operations do not clear it; use the manual clear button in settings. Credentials, cookies and page content are excluded from diagnostics.
