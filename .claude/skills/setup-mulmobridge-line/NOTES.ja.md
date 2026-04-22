# Setup LINE Bridge — 開発者確認用メモ

> このファイルは Claude に読まれません。SKILL.md の内容を日本語で確認するためのものです。

## Step 1: 前提チェック

1. MulmoClaude が起動しているか確認（`lsof -i :3001`）。未起動なら別ターミナルで `yarn dev` を実行するよう案内
2. ngrok がインストールされているか確認（`which ngrok`）。未インストールなら `brew install ngrok` + authtoken 設定を案内

## Step 2: ドキュメントに従ってセットアップ

`docs/message_apps/line/` のドキュメントを読み、ユーザーの言語に合わせて案内する（README.md / README.ja.md）。

ハマりやすいポイント：

- Webhook URL の末尾に `/webhook` を付ける（忘れると 404）
- LINE 公式アカウント設定 → 応答メッセージ → OFF（二重返信防止）
- `.env` に `LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` を追加

## Step 3: ブリッジ起動

```bash
node packages/bridges/line/dist/index.js
```

- `npx @mulmobridge/line` はモノレポ内では動かない（yarn workspaces が bin のシンボリックリンクを作らないため）
- 失敗時はドキュメントのトラブルシューティング表を参照
