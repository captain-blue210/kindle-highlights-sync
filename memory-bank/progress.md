# 進捗状況 (日本語更新: 2025-03-30)

## 1. 機能していること

*   **Amazon認証:**
    *   指定されたAmazonリージョンのログインページを独立した `BrowserWindow` で表示できる。
    *   ログイン成功を検出し、ウィンドウを非表示にして参照を保持できる (`AmazonLoginModal`)。
    *   `KindleApiService` がログイン状態 (`loggedIn`) とウィンドウ参照 (`loginWindow`) を管理できる。
*   **ノートブックページへのアクセス:**
    *   ログイン時に保持した `BrowserWindow` を再利用して、Kindle Notebook ページ (`read.amazon.com/notebook` など) にアクセスできる (`loadRemoteDom`)。
    *   User-Agent を設定してアクセスできる。
*   **コンテンツの動的読み込み待機:**
    *   `loadRemoteDom` 内でタイムアウトを設定し、ページの初期読み込み後に待機することで、JavaScriptによる動的コンテンツ（書籍リストなど）の読み込みを待機できる（現在は5秒）。
    *   コンテンツ（`.kp-notebook-library-each-book`）が存在するかどうかを確認できる。
*   **書籍情報の抽出:**
    *   読み込んだノートブックページのHTMLから、書籍の基本情報（ASIN/ID, タイトル, 著者, 画像URL, 最終更新日）を抽出できる (`KindleApiService` 内のパーサー）。
    *   日付文字列を `moment` を使ってパースできる（日本語形式対応済み）。
*   **ビルド:** `npm run build` および `npm run deploy:test` が警告なしで成功する。
*   **テンプレートレンダリング:**
    *   Nunjucksテンプレートのレンダリングエラー（構文、不明なタグ、空白/改行処理）を修正し、基本的なノート構造を出力できるようになった (`TemplateRenderer`, `settings.ts`)。
*   **Kindleアプリリンク (`appLink`) 生成:** 各ハイライトに対応する `kindle://` 形式のディープリンクを生成し、Markdown出力に追加できる (`src/main.ts`)。
*   **ファイル保存:** 出力ディレクトリパスを正規化（先頭/末尾スラッシュ除去）することで、`getAbstractFileByPath` が `null` を返す問題を解消し、既存ファイルの更新と新規ファイルの作成が正常に行えるようになった (`src/main.ts`)。
*   **ハイライト情報の抽出:** ノートブックページのHTMLから、ハイライトのテキスト、位置 (`location`)、メモ (`note`)、色 (`color`) を抽出できる (`KindleApiService` 内)。

## 2. 残っているタスク

*   **リージョン対応の完全化:**
    *   `parseToDateString` や書籍URL生成ロジックが、設定されたAmazonリージョンに基づいて正しく動作するように修正する。
    *   `REGION_URLS` に含まれていない他のリージョン（例: `fr`）の日付形式などに対応する。
*   **ノート生成の最終調整:**
    *   抽出した書籍情報とハイライトデータを使って、`TemplateRenderer` が意図通りにMarkdownノートを生成できるか最終確認・調整する（基本的なレンダリング、`appLink`、ハイライト抽出は機能するようになった）。
    *   テンプレート内で新しい書籍フィールド (`asin`, `url`, `imageUrl`, `lastAnnotatedDate`) や抽出されたハイライトの色情報 (`color`) などを利用できるようにする。
*   **リファクタリング:**
    *   `KindleApiService` 内のHTMLパースロジックを `HighlightParser` サービスに分離する。
*   **ログアウト処理の改善:**
    *   保持している `BrowserWindow` のセッション（Cookieなど）を確実にクリアするログアウト機能を実装する。
*   **エラーハンドリングの強化:**
    *   セッション切れ、ネットワークエラー、予期せぬHTML構造など、より多くのエッジケースに対応する。
    *   ユーザーへのフィードバックをより分かりやすくする。
*   **UI/UX:**
    *   設定画面でリージョン選択などを分かりやすく表示する。
    *   同期中の進捗表示（任意）。
    *   リボンアイコンの追加（任意）。
*   **テスト:**
    *   様々なアカウント、書籍、ハイライトデータでテストする。
    *   異なるAmazonリージョンでテストする。

## 3. 現在のステータス

*   コアとなるHTML取得、書籍情報と**ハイライト情報の抽出**（色情報含む）、Kindleアプリリンクの生成、ノートのファイル保存/更新は機能するようになった。
*   `electron.remote` を利用するアーキテクチャに移行したが、そのリスクは認識している。
*   より詳細な機能（リージョン対応、ノート生成の最終調整など）の実装が必要。（注: ハイライト色のマッピングは意図的に省略）

## 4. 既知の問題点

*   `electron.remote` の利用に伴う潜在的なリスク（非推奨、将来の互換性）。
*   HTMLスクレイピングに依存するため、Amazon側のUI変更に弱い。
*   動的コンテンツの読み込み待機時間が固定（5秒）であり、環境によっては不安定になる可能性がある。
