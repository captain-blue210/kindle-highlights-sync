# システムパターン: Obsidian Kindle Highlights Sync (日本語更新: 2025-04-06)

## 1. 全体アーキテクチャ

プラグインは、MVCやMVVMのような形式的なデザインパターンに厳密に従うのではなく、比較的シンプルで中央集権的なアーキテクチャを採用しています。コアとなる`KindleHighlightsPlugin`クラス (`src/main.ts`) が中央のオーケストレーターとして機能します。

## 2. 主要コンポーネントとインタラクション

```mermaid
graph TD
    User --> ObsidianUI[Obsidian UI (リボン, コマンドパレット, 設定)]
    ObsidianUI --> MainPlugin(KindleHighlightsPlugin / main.ts)

    subgraph Plugin Core
        MainPlugin --> SettingsTab(SettingsTab / settings.ts)
        MainPlugin -->|同期をトリガー| SyncProcess{同期ロジック}
        MainPlugin -->|ログインが必要| LoginModal(AmazonLoginModal / modals/AmazonLoginModal.ts) ;; 独立ウィンドウ生成
        MainPlugin -->|ログアウトが必要| LogoutProcess{ログアウトプロセス}
        MainPlugin -->|ステータス表示| SyncProgressModal(SyncProgressModal / modals/SyncProgressModal.ts) ;; イベント経由で更新
        MainPlugin -->|イベント発行| Emitter((EventEmitter))
        SyncProgressModal -->|イベント購読| Emitter

        SyncProcess --> KindleAPI(KindleApiService / services/kindle-api.ts)
        SyncProcess --> KindleAPI --> Parser(HighlightParser / services/highlight-parser.ts) ;; KindleAPIがParserを利用
        SyncProcess --> Renderer(TemplateRenderer / services/template-renderer.ts)
        SyncProcess --> MetadataService(MetadataService / services/metadata-service.ts)
        SyncProcess --> VaultAPI[Obsidian Vault API]
        SyncProcess -->|イベント発行| Emitter ;; 同期中の詳細イベント


        LoginModal -->|Electron BrowserWindow生成/管理| AmazonLoginWindow[Amazon Login (別ウィンドウ)] ;; electron.remote経由
        LoginModal -->|成功/失敗(ウィンドウ参照含む)| MainPlugin

        KindleAPI -->|データ取得指示(ウィンドウ参照使用)| RemoteLoader(loadRemoteDom / utils/remote-loader.ts)
        RemoteLoader -->|コンテンツ操作/取得| AmazonLoginWindow ;; 既存ウィンドウ再利用
        RemoteLoader -->|取得DOMを返す| KindleAPI
        KindleAPI -->|DOMを渡す| Parser
        Parser -->|構造化データを返す| KindleAPI
        KindleAPI -->|イベント発行| Emitter ;; データ取得中の詳細イベント


        Renderer --> VaultAPI
    end

    SettingsTab --> MainPlugin -- 設定保存

    LogoutProcess -->|セッションクリア指示?| KindleAPI ;; ログアウト処理はKindleAPIへ
    LogoutProcess -->|完了通知| MainPlugin
```

*   **`KindleHighlightsPlugin` (`src/main.ts`):**
    *   メインエントリポイントであり、中央コントローラー。
    *   プラグインの初期化、設定の読み込み、コマンドの登録、リボンアイコンの追加、設定タブのセットアップを行う。
    *   同期プロセスを調整し、`AmazonLoginModal` を呼び出して認証状態を確認・実行する。
    *   様々な`Service`クラスをインスタンス化し、対話する。
*   **`SettingsTab` (`src/settings.ts`):**
    *   プラグイン設定（Amazonリージョン、ノートテンプレート、出力フォルダなど）のためのUIを提供する。
    *   Obsidianのデータ永続化メカニズムを使用して設定を保存する。
*   **`AmazonLoginModal` (`src/modals/AmazonLoginModal.ts`):**
    *   `electron.remote` (Obsidian環境で利用可能な場合) を介して、独立したElectron `BrowserWindow` (`AmazonLoginWindow`) を生成・表示し、Amazonのログインページをロードする。
    *   `BrowserWindow`内のナビゲーションを監視し、ログイン成功（Cloud Reader URLへのリダイレクトなど）を検出する。
    *   ログイン成功時には、ウィンドウを閉じる代わりに**非表示**にし、そのウィンドウの参照を含む結果を返す。失敗時やキャンセル時には失敗ステータスのみを返す。
*   **`KindleApiService` (`src/services/kindle-api.ts`):**
    *   Amazon関連の通信全般を担当。
    *   `login` メソッド内で `AmazonLoginModal` を呼び出し、成功時に返された `BrowserWindow` の参照 (`loginWindow`) を保持する。
    *   `fetchHighlights` メソッド内で、保持している `loginWindow` を `loadRemoteDom` ユーティリティに渡し、Kindle Notebook ページのコンテンツを取得する。
    *   取得したDOMを `HighlightParser` に渡し、書籍とハイライトの情報を解析させる。
    *   ログアウト処理（セッションクリアの試行）も担当する。
*   **`loadRemoteDom` (`src/utils/remote-loader.ts`):**
    *   指定されたURLを非表示の `BrowserWindow` で読み込むユーティリティ関数。
    *   既存の `BrowserWindow` インスタンスを再利用するオプションを持つ。
    *   ページの読み込み完了後、指定されたタイムアウト時間待機し、`body` の `innerHTML` を取得して Cheerio オブジェクトとして返す。
    *   User-Agent の設定やエラーハンドリング、タイムアウト処理を行う。
*   **Services (`src/services/` 内のその他):**
    *   **`HighlightParser` (`highlight-parser.ts`):** Kindle Cloud Readerから取得したHTML (Cheerioオブジェクト) を受け取り、構造化された`Book`および`Highlight`モデルに解析する責務を持つ。`KindleApiService` によって利用される。
    *   **`TemplateRenderer` (`template-renderer.ts`):** 構造化されたデータとユーザー定義のテンプレートを受け取り、Obsidianノート用のMarkdownコンテンツを生成する。
    *   **`MetadataService` (`metadata-service.ts`):** 主に `KindleApiService` で取得した書籍情報（ASINなど）を構造化する。将来的には外部APIから追加情報を取得する可能性もある。
*   **Models (`src/models/`):** プラグイン全体で使用されるデータ構造（`Book`, `Highlight`）を定義する。

## 3. 設計上の決定とパターン

*   **中央集権的制御:** ロジックは主に`MainPlugin`クラスから流れる。
*   **サービスレイヤー:** 機能はサービス（API, Parsing, Rendering, Metadata）にグループ化され、関心の分離を促進する。
*   **`BrowserWindow`ベースの認証/データ取得:** ログインとデータ取得は、`electron.remote` を介して生成・管理される独立した非表示のElectronウィンドウで行われる。このウィンドウはログイン後も保持され、再利用される。
*   **設定による構成:** プラグインの動作は、標準のObsidian設定タブを通じてカスタマイズされる。
*   **非同期操作:** API（Obsidian, Amazon）との対話やファイルシステム操作は非同期であり、`async/await`を使用する。
*   **ユーティリティ関数:** `BrowserWindow` の操作ロジックは `loadRemoteDom` にカプセル化される。
*   **イベント駆動 (UI更新):** 同期プロセスの進捗表示 (`SyncProgressModal`) は、Node.js の `EventEmitter` を介して行われる。`KindleApiService` や `main.ts` が同期の各段階でイベントを発行し、`SyncProgressModal` がそれを購読してUIを更新する。これにより、UIコンポーネントとバックグラウンド処理が疎結合になる。

## 4. 状態管理

*   プラグイン設定は、Obsidian APIが提供する`loadData()`および`saveData()`を介して管理される。
*   認証状態 (`loggedIn` フラグ) とログインに使用した `BrowserWindow` の参照 (`loginWindow`) は `KindleApiService` 内で管理される。Electronのセッション（Cookieなど）は `BrowserWindow` インスタンスに紐づいて維持される。

## 5. エラーハンドリング

*   `loadRemoteDom` 内でURL読み込み失敗やタイムアウトを処理する。
*   `KindleApiService` 内でログイン失敗、リージョン無効、コンテンツ取得失敗などを処理し、`Notice` APIでユーザーに通知する。(`HighlightParser` は純粋なパース処理に集中し、エラーハンドリングは呼び出し元で行う想定)。
*   `AmazonLoginModal` 内でウィンドウ生成失敗などを処理する。
