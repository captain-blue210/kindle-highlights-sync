# 実行計画：Kindle Cloud Reader ハイライト情報抽出 (electron.remote版)

**最終更新日:** 2025-03-30

**目標:** `KindleApiService` 内で、`loadRemoteDom` ユーティリティ（内部で `electron.remote` を使用）を利用して Kindle Cloud Reader のノートブックページの HTML を取得し、`cheerio` で解析してハイライト情報を抽出する。

**前提:**

*   認証プロセスは完了しており、`AmazonLoginModal` によって生成・保持されているログイン済みの `BrowserWindow` インスタンスが `KindleApiService` 内で利用可能である (`loginWindow` プロパティ)。
*   HTML解析ライブラリ `cheerio` がプロジェクトに追加されている。
*   書籍情報の基本的な抽出ロジックは `KindleApiService` 内に既に存在する。

**ステップ:**

1.  **`KindleApiService.fetchHighlights` の確認/修正:**
    *   既存の `fetchHighlights` メソッド内で `loadRemoteDom` を呼び出し、ノートブックページの完全なHTMLを取得する部分を確認する。
    *   `loadRemoteDom` から返されたHTML文字列を `cheerio.load()` に渡して解析オブジェクト (`$`) を生成する。

2.  **ハイライト要素の特定と反復処理:**
    *   `cheerio` オブジェクト (`$`) を使用して、ノートブックページ内の各ハイライトを表すHTML要素を特定するためのCSSセレクタ (`HIGHLIGHT_CONTAINER_SELECTOR` など) を検証・修正する。
    *   特定したセレクタを使ってハイライト要素群を取得し、`.each()` などで反復処理を行う。

3.  **ハイライト情報の抽出:**
    *   反復処理の中で、各ハイライト要素から以下の情報を抽出するためのCSSセレクタとロジックを実装・検証する。
        *   ハイライトテキスト (`HIGHLIGHT_TEXT_SELECTOR`)
        *   ハイライトの色 (`HIGHLIGHT_COLOR_SELECTOR` - クラス名などから色を特定)
        *   位置情報 (`HIGHLIGHT_LOCATION_SELECTOR`)
        *   ページ番号 (`HIGHLIGHT_PAGE_SELECTOR` - 存在する場合)
        *   関連付けられたメモ (`HIGHLIGHT_NOTE_SELECTOR` - 存在する場合)
    *   抽出した色情報（例: クラス名 `kp-notebook-highlight-yellow`）を、定義済みの色名（例: `'yellow'`）にマッピングするロジック（例: `mapCssClassToColor` 関数）を実装または利用する。

4.  **`Highlight` モデルへの格納:**
    *   抽出した各情報を、`src/models/highlight.ts` で定義されている `Highlight` モデルのインスタンスに格納する。
    *   すべてのハイライト情報を `Highlight[]` 配列として収集する。

5.  **エラーハンドリング:**
    *   HTML構造の変更によりセレクタが見つからない場合や、予期せぬデータ形式に対するエラーハンドリングを追加・強化する。

**次のステップ (Codeモード):**

*   ステップ2のハイライト要素特定のためのCSSセレクタを検証・修正する。
*   ステップ3の各ハイライト情報の抽出ロジックと色マッピングを実装・検証する。
*   ステップ4の `Highlight` モデルへのデータ格納を実装する。
*   ステップ5のエラーハンドリングを実装する。
