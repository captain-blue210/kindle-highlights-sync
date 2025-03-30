# 技術コンテキスト: Obsidian Kindle Highlights Sync (日本語更新: 2025-03-30)

## 1. コア技術

*   **言語:** TypeScript - 静的型付けによりコード品質と保守性を向上させる。
*   **ランタイム:** Node.js - 依存関係管理（npm）とビルドプロセスに使用される。
*   **フレームワーク:** Obsidian Plugin API - Obsidianの機能を拡張するために提供される公式APIを活用する。
*   **基盤:** Electron - Obsidian自体が動作するフレームワーク。**認証とデータ取得のために、プラグインのレンダラープロセスから `electron.remote` モジュール（`window.require`経由でアクセス試行）を利用してElectronの`BrowserWindow` APIを呼び出す。** これはElectronの推奨アプローチではないが、Obsidianプラグイン環境での実装を簡略化するために採用。

## 2. ビルド＆開発ツール

*   **バンドラ:** esbuild - 高速なTypeScriptコンパイルとプラグインコードの`main.js`へのバンドルに使用される。`esbuild.config.mjs`で設定。
*   **パッケージマネージャ:** npm - `package.json`および`package-lock.json`にリストされたプロジェクトの依存関係を管理する。
*   **リンター:** ESLint - コードスタイルを強制し、潜在的なエラーを特定する。`.eslintrc`で設定。
*   **設定ファイル:**
    *   `tsconfig.json`: TypeScriptコンパイラオプションを設定。`esModuleInterop: true` が有効化されている。
    *   `.editorconfig`: 異なるエディタ間で一貫したコーディングスタイルを維持するのに役立つ。
    *   `.gitignore`: Gitで意図的に追跡しないファイルを指定。

## 3. 使用される主要なObsidian APIコンポーネント（推測）

*   `Plugin`: Obsidianプラグインのベースクラス (`main.ts`)。
*   `PluginSettingTab`, `Setting`: プラグインの設定インターフェースを作成するため (`settings.ts`)。
*   `Notice`: ユーザーへの短い通知（同期成功/失敗など）を表示するため。
*   Obsidian Commands API: 同期やログアウトをトリガーするためのコマンドを登録するため。
*   Ribbon Icon API: 同期をトリガーするためのリボンアイコンを追加するため (未実装)。
*   `requestUrl`: (現状未使用) 将来的に他のAPI連携で使用される可能性あり。

## 4. プロジェクト構造

*   `src/`: すべてのソースコードを含む。
    *   `main.ts`: プラグインエントリポイント。
    *   `settings.ts`: プラグイン設定を処理。
    *   `modals/`: モーダルコンポーネント定義 (`AmazonLoginModal`, `AmazonLogoutModal`)。
    *   `models/`: データ構造 (`Book`, `Highlight`) を定義。`Book` には `asin`, `url`, `imageUrl`, `lastAnnotatedDate` が追加された。
    *   `services/`: 特定の機能（API対話, メタデータ処理, レンダリング）をカプセル化。
    *   `templates/`: Obsidianノート生成用のテンプレートを含む。
    *   `utils/`: 汎用的なユーティリティ関数 (`remote-loader.ts` など)。
*   `manifest.json`: Obsidianが必要とするプラグインメタデータ。
*   `versions.json`, `version-bump.mjs`: プラグインのバージョン管理に使用。

## 5. 依存関係

*   **ランタイム:**
    *   `obsidian`: Obsidian API。
    *   `moment`: 日付処理ライブラリ (`parseToDateString` で使用)。
    *   `cheerio`: HTML解析ライブラリ (`KindleApiService` で使用)。
*   **開発:**
    *   `typescript`, `esbuild`, `@types/node`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint` など。
    *   `@types/cheerio`: Cheerioの型定義。
    *   `@types/electron`: (現在は `^1.6.12` を使用) Electron APIの型定義。`remote` モジュールの型解決のために必要。

## 6. 技術的制約と考慮事項

*   **`electron.remote` への依存:**
    *   `remote` モジュールはElectronで非推奨であり、セキュリティリスクやパフォーマンスの問題がある。
    *   Obsidianの将来のバージョンで `remote` モジュールへのアクセスが完全にブロックされる可能性がある。
    *   `window.require('electron')` が常に機能する保証はない。
*   **スクレイピングの脆弱性:** Kindle Cloud ReaderのHTML構造に依存しているため、Amazon側のUI変更によって機能が停止するリスクが高い。
*   **動的コンテンツ:** ノートブックページのコンテンツは動的に読み込まれるため、`loadRemoteDom` 内で適切な待機時間（現在は5秒）が必要。この時間は環境によって調整が必要になる可能性がある。
*   **セッション管理:** ログインセッションは非表示の `BrowserWindow` インスタンスに依存している。ウィンドウが予期せず閉じられたり、セッションが期限切れになったりした場合のハンドリングが必要。
*   **エラーハンドリング:** ネットワークエラー、ログイン失敗、HTML構造の変更、パースエラーなど、様々なエラーケースを考慮する必要がある。
