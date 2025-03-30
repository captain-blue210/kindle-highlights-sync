# 実行計画：Kindle Cloud Reader HTML取得と解析 (推奨IPC版)

**最終更新日:** 2025-03-30

**目標:** `KindleApiService` 内で、Electron の `BrowserWindow` を利用して Kindle Cloud Reader のページの `<body>` 内 HTML を取得し、`cheerio` で解析可能にする。**安全なIPCメカニズムを使用する。**

**前提:**

*   認証プロセスは完了しており、Kindle Cloud Reader にログイン済みの `BrowserWindow` セッションが存在するか、アクセス可能である。
*   Obsidianプラグイン（レンダラープロセス）とElectronメインプロセス間で安全な通信（IPC）を確立する必要がある。

**ステップ:**

1.  **依存関係の追加:**
    *   HTML解析ライブラリ `cheerio` をプロジェクトに追加します (`npm install cheerio @types/cheerio --save-dev`)。
    *   Electron の型定義 (`@types/electron`) が必要になる場合があります（プロジェクトに既に入っているか確認）。

2.  **IPCメカニズムの設計と実装 (`ElectronLayer`):**
    *   **Preloadスクリプトの作成:**
        *   `BrowserWindow` を作成する際に指定する `preload.js` (または `.ts`) ファイルを作成します。
        *   このスクリプト内で `contextBridge` と `ipcRenderer` をインポートします。
    *   **`contextBridge.exposeInMainWorld` の使用:**
        *   Preloadスクリプト内で、レンダラープロセス（プラグインコード）から安全に呼び出せるAPIオブジェクト（例: `window.electronAPI`）を公開します。
        *   このAPIオブジェクトには、メインプロセスと通信するための非同期関数を含めます（例: `loadUrl(url: string): Promise<void>`, `executeJavaScript(script: string): Promise<any>`, `getWindowId(): Promise<number | null>` など）。
    *   **`ipcRenderer` の使用:**
        *   公開する関数内で `ipcRenderer.invoke('channel-name', ...args)` を使用して、メインプロセスに処理を要求し、結果を待ちます。チャネル名（例: `'load-url'`, `'execute-js'`）を定義します。
    *   **`ipcMain` の実装:**
        *   メインプロセス側（Obsidianがどのようにメインプロセスコードの実行を許可するかに依存しますが、理想的にはObsidian本体か、信頼できる方法でロードされるコード内）で、`ipcMain.handle('channel-name', async (event, ...args) => { ... })` を使用して、`ipcRenderer` からの要求を待ち受けます。
        *   ハンドラ内で、対応する `BrowserWindow` を特定し、要求された操作（`window.loadURL()`, `webContents.executeJavaScript()` など）を実行し、結果を返します。
    *   **Obsidianとの連携:** このIPCメカニズム（特にメインプロセス側のハンドラ設定）をObsidianプラグインのライフサイクル内でどのようにセットアップするかが重要な課題となります。Obsidianが提供するAPIやベストプラクティスを確認する必要があります。

3.  **`KindleApiService` (`src/services/kindle-api.ts`) の変更:**
    *   `contextBridge` を介して公開されたAPI（例: `window.electronAPI`）を呼び出すようにコードを修正します。
    *   新しい非同期メソッド `async getCloudReaderHtml(): Promise<string>` を追加します。
    *   このメソッド内で、公開されたIPC関数（例: `window.electronAPI.executeJavaScript('document.body.innerHTML')`）を呼び出してHTML取得処理を実装します。
    *   ページの読み込み完了待機なども、同様にIPC経由でメインプロセスに指示して行います（例: `window.electronAPI.waitForPageLoad()`）。
    *   エラーハンドリング（IPCエラー、JS実行エラーなど）を実装します。

4.  **Cheerioでの解析:**
    *   `getCloudReaderHtml` メソッドから返されたHTML文字列を `cheerio.load()` に渡して解析オブジェクトを生成します。
    *   例:
        ```typescript
        import * as cheerio from 'cheerio';
        // ... inside KindleApiService or where the HTML is used ...
        const html = await this.getCloudReaderHtml(); // Assumes this uses the IPC layer
        const $ = cheerio.load(html);
        // Now '$' can be used to query the DOM
        ```

**次のステップ (Codeモード):**

*   ステップ1の依存関係を追加する。
*   ステップ2のIPCメカニズムを設計・実装する (Preloadスクリプト、`contextBridge`、`ipcMain`ハンドラ)。
*   ステップ3の`KindleApiService`を修正する。
*   ステップ4のCheerio解析部分を実装する。
