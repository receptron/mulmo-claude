# MulmoClaude — Claude Code を安全に、もっと自由に、ブラウザから

## MulmoClaude とは

Claude Code をブラウザで **並列実行** できるアプリ。

ターミナルで 1 セッションずつ使う Claude Code を、Web UI から複数同時に操作できます。調べ物しながらコード書かせて、別タブで文書を作らせて、さらに別タブで Todo を整理 — 全部並列。

会話の中身は **すべてローカルファイル**。Wiki ページ、Todo リスト、スケジュール、メモ — Claude が書いたものは全部 `~/mulmoclaude/` に plain text で残ります。ロックインなし、git で履歴管理。

> **一言で**: Claude Code の能力を、ブラウザ UI + プラグイン + 外部アクセスで 10 倍活用するためのプラットフォーム。

---

## 安全性

- **Docker サンドボックス**: Claude のファイルアクセスを隔離。`--cap-drop ALL` でコンテナ権限を最小化
- **SSH agent forwarding**: ホスト制限付き (デフォルト `github.com` のみ)。`~/.ssh/config` で `Host *` → `IdentityAgent none` として、ホワイトリスト host だけ agent を開放
- **Bearer token 認証**: `/api/*` 全エンドポイントに認証。起動ごとにランダムトークン再生成
- **データは全てローカル**: クラウドに送信されません。`~/mulmoclaude/` 以下に plain text で永続化

---

## Karpathy の「LLM Wiki」を実現

Andrej Karpathy が提唱した **「LLM が自律的に知識を蓄積・構造化する Wiki」** — MulmoClaude はこれを実装しています。

会話の中で Claude が Wiki ページを作り、更新し、リンクし、要約する。使うほど知識が育ち、次の会話で活用される。

**3 層の長期記憶**:
- **`memory.md`** — ユーザーの好み、フィードバック、プロジェクト情報を蓄積。毎回のセッションで自動ロード
- **Wiki** — 構造化された知識ベース。ページ間リンク、タグ、ログ。Claude が自律的に作成・更新
- **Journal** — 日次サマリー + トピック別アーカイブ。過去の会話を圧縮して長期保存

---

## こんなことができます

### 📚 Wiki が勝手に育つ

「○○について調べて Wiki にまとめて」→ Claude が検索して、ページを作り、目次を更新。次の会話で「前に調べた○○の続き」と言えば Wiki を読んで文脈を理解。**知識が蓄積する AI**。

### ⚡ Skill = 自分だけのコマンド

「このワークフロー、Skill にして」→ 次から `/deploy` 一発で同じ手順を再実行。チャットから作成・編集可能。

### 📱 外出先から Telegram で

スマホの Telegram から「今日の Todo 確認して」「○○の issue 作って」。家の PC で動いている MulmoClaude に安全にアクセス。

### 🔒 Docker サンドボックス

Claude にファイル操作させても安心。Docker 内で隔離実行、SSH/GitHub 認証も安全に forwarding。Docker なしでも動作。

### 🔌 MCP サーバー自由追加

`config/mcp.json` に MCP サーバーを追加するだけで、任意のツールを Claude に使わせられます。Web Settings UI から GUI で設定可能。

---

## vs 他のツール

### vs Claude Code 単体

| | Claude Code | MulmoClaude |
|---|---|---|
| インターフェース | ターミナル (1 セッション) | ブラウザ (並列セッション) |
| 表示 | テキスト | チャート・画像・スプレッドシート・Wiki |
| プラグイン | なし | 15+ (Todo / スケジューラー / 画像生成 etc.) |
| 外部アクセス | なし | Telegram / CLI bridge |
| 長期記憶 | なし | memory + Wiki + Journal + Skill |
| MCP | 対応 | 対応 + Web Settings UI で設定 |

### vs Open Claw 等

- MCP サーバーを自由に追加可能 (`config/mcp.json`)
- Claude Code の全機能 (Bash, Read, Write, WebSearch 等) をそのまま活用
- npm パッケージとして bridge を公開 — 自分のプラットフォーム用 bridge を 50 行で書ける
- オープンソース — フォークして自分好みにカスタマイズ可能

---

## 誰のためのツール？

### 👤 普通に便利に使いたい人

- 「毎朝のニュースまとめを自動で作ってほしい」→ RSS + 日次バッチ
- 「調べたことを忘れたくない」→ Wiki に蓄積、いつでも呼び出し
- 「Todo とスケジュールを AI に管理してほしい」→ チャットで追加・確認
- 「スマホから家の AI に話しかけたい」→ Telegram bridge
- 「ChatGPT だとファイルが消える」→ 全部ローカル保存、永久保持

### 🤓 Geek 向け

- Claude Code の並列実行 — ブラウザタブ = セッション、同時に何本でも
- MCP サーバー統合 — 任意の tool を `config/mcp.json` で追加
- `@mulmobridge/*` npm パッケージ — 自分の bridge を 50 行で書ける
- テキストストリーミング — Web / CLI / Telegram 全部トークン単位で逐次表示
- ワークスペースは git repo — `git log` で AI の全作業履歴を追跡
- `Dockerfile.sandbox` カスタマイズ — pandas, ffmpeg, pandoc 等プリインストール

---

## 5 分で始める

**前提**: Claude Code CLI がインストール・認証済み

```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

### Web UI (ブラウザ)

```bash
git clone https://github.com/receptron/mulmoclaude.git
cd mulmoclaude && yarn install
yarn dev
# → http://localhost:5173 を開いて会話開始！
```

### CLI bridge (ターミナルから)

```bash
npx @mulmobridge/cli@latest
```

### Telegram bridge (スマホから)

```bash
TELEGRAM_BOT_TOKEN=xxx \
TELEGRAM_ALLOWED_CHAT_IDS=123 \
  npx @mulmobridge/telegram@latest
```

---

## リンク

- **GitHub**: https://github.com/receptron/mulmoclaude
- **Developer Guide**: [docs/developer.md](developer.md)
- **Telegram セットアップ**: [docs/message_apps/telegram/](message_apps/telegram/)
- **Issue / PR 歓迎**: https://github.com/receptron/mulmoclaude/issues
