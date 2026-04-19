# MulmoClaude（exe.dev フォーク）

[receptron/mulmoclaude](https://github.com/receptron/mulmoclaude) の exe.dev 環境向けフォークです。機能は upstream と同一です。機能の詳細は upstream の README を参照してください。

## セットアップ（exe.dev 環境）

**前提**: Claude Code CLI が認証済みであること（exe.dev VM には事前インストール済み）。

```bash
git clone https://mulmoclaude.int.exe.xyz/YTommy109/mulmoclaude.git
cd mulmoclaude
yarn install
cp .env.example .env
```

`.env` を編集して以下を設定します：

| 変数 | 設定値の例 | 用途 |
|---|---|---|
| `GEMINI_API_KEY` | `AIza...` | 画像生成機能（任意） |
| `VITE_PORT` | `8000` | Vite 開発サーバーのポート |
| `VITE_ALLOWED_HOSTS` | `myvm.exe.xyz` | リバースプロキシ経由アクセスの許可 |
| `ALLOWED_ORIGINS` | `https://myvm.exe.xyz:8000` | CSRF チェックの許可オリジン |
| `ALLOWED_HOSTS` | `myvm.exe.xyz` | CSRF チェックの許可ホスト |

```bash
yarn dev
```

起動後は `https://<vm-id>.exe.dev` からアクセスします（localhost:8000 ではありません）。

## exe.dev 向けの改変内容

upstream に対して以下の変更を加えています。upstream merge 時はこれらを維持してください。

| ファイル | 変更内容 | 理由 |
|---|---|---|
| `server/index.ts` | `sandboxEnabled` 時の Docker ブリッジ IP 二次リスナー | Docker コンテナ内 MCP → ホスト HTTP の到達性確保 |
| `server/docker.ts` | `getDockerBridgeIp()` の追加 | docker0 インターフェースの取得（Node の `networkInterfaces` が DOWN を無視するため） |
| `server/csrfGuard.ts` | `EXTRA_ALLOWED_ORIGINS` / `EXTRA_ALLOWED_HOSTS` の読み取り | exe.dev リバースプロキシ経由アクセスの CSRF 許可 |
| `vite.config.ts` | `VITE_PORT` / `VITE_ALLOWED_HOSTS` の env 読み取り | exe.dev ポート要件とホスト名の外部化 |
| `e2e/playwright.config.ts` | `VITE_PORT` からのポート読み取り | テスト環境ポートの統一 |

## upstream との同期

```bash
git fetch upstream
git log upstream/main ^main --oneline   # 差分を確認
git merge upstream/main
# コンフリクト解決（上記テーブルの変更を exe.dev 側に保つ）
yarn format && yarn lint && yarn typecheck && yarn build
```
