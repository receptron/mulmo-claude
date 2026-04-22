# @mulmobridge/slack

> **試験運用中** — ぜひ使ってみて [Issue で報告](https://github.com/receptron/mulmoclaude/issues/new) してください。フィードバックが開発の助けになります。

[MulmoClaude](https://github.com/receptron/mulmoclaude) 向けの Slack ブリッジ。**Socket Mode** を使うので、公開 URL や ngrok は不要です。

English: [`README.md`](README.md)

## セットアップ

### 1. Slack アプリを作成

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. 名前（例: `"MulmoClaude"`）と利用するワークスペースを選択

### 2. 権限を設定

**OAuth & Permissions** → 以下の Bot Token Scope を追加:
- `chat:write` — メッセージ送信
- `channels:history` — 公開チャネルのメッセージ閲覧
- `groups:history` — プライベートチャネルのメッセージ閲覧
- `im:history` — DM の閲覧
- `mpim:history` — グループ DM の閲覧

### 3. Socket Mode を有効化

**Socket Mode** → **Enable Socket Mode** をオンにして、`connections:write` スコープで App-Level Token を作成。`xapp-...` トークンをコピー。

### 4. Event を有効化

**Event Subscriptions** → **Enable Events** をオンにして、以下にサブスクライブ:
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`

### 5. ワークスペースにインストール

**Install App** → **Install to Workspace** → `xoxb-...` Bot User OAuth Token をコピー。

### 6. ブリッジを起動

```bash
# モックサーバー（テスト用）
npx @mulmobridge/mock-server &
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/slack

# 実 MulmoClaude と連携
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
npx @mulmobridge/slack
```

### 7. bot をチャネルに招待

Slack で `/invite @MulmoClaude` を実行して bot をチャネルに招待。

---

## セッション粒度（新機能）

> **「セッション」とは?** MulmoClaude では、1つの *セッション* = AI との 1 本の会話履歴です。AI はそのセッション内で過去の発言を覚えていて、それを踏まえて返事します。以下の設定は **1 つの Slack チャネルが何個のセッションに分割されるか** を決めます。

`SLACK_SESSION_GRANULARITY` 環境変数で 3 モードから選べます:

### 🗂 `channel`（デフォルト）— チャネルあたり 1 セッション

`#ai-help` の中のすべての発言が **1 本の長い会話** になります。誰が話しても、スレッドを使っていても、全部同じ会話扱いです。

```text
#ai-help
├── Alice: 「昨日のスタンドアップまとめて」            ┐
├── Alice: 「それ日本語に訳して」                      │  ← 1セッション。
├── Bob:   「アクションアイテムはどう?」                │    AI が上の
│   ├── Alice: 「私に割り振られたやつだけ」             │    発言全部を
│   └── Bob:   「了解」                                │    覚えている
└── Alice: 「それをもとにステータス共有を下書きして」   ┘
```

**こういう人におすすめ:** 小規模チーム、または `@claude` との個人 DM。すべての発言が一続きの会話になっている場合。

**注意点:** 何週間も使い続けるとセッションに大量のコンテキストが溜まり、AI が古い情報まで引っぱり始めて応答が遅く（&高く）なります。リセットしたいときは **別チャネルを作る** のが確実です。

### 🧵 `thread` — Slack スレッドあたり 1 セッション

チャネル直下（スレッド外）の発言は `channel` モードと同じく 1 セッションを共有しますが、**スレッド内の返信は独立したセッション** になります。

```text
#ai-help
├── Alice: 「昨日のスタンドアップまとめて」            ┐
├── Alice: 「それ日本語に訳して」                      │  ← チャネルセッション
│                                                    │    (スレッド外発言)
├── Bob:   「アクションアイテムはどう?」   ────────── ┤
│   │                                                │
│   ├── Alice: 「私に割り振られたやつだけ」            ├  ← スレッドセッション #1
│   └── Bob:   「了解」                               │    (チャネルセッションとは
│                                                    │     独立)
├── Alice: 「ステータス共有下書いて」     ──────────  ┤
│   ├── Dev:   「デプロイノートも入れて」              ├  ← スレッドセッション #2
│   └── Alice: 「完璧」                                │
```

**こういう人におすすめ:** 複数人が別々の質問を投げる `#ai-help` や `#general` のような共有チャネル。スレッドで話題を分離するので「Alice の翻訳タスク」と「Bob のデプロイ質問」が混ざらない。

**注意点:** 各スレッドが別セッション扱いなので、AI は同じチャネル内の別スレッドの文脈を自動では知りません。「昨日の投稿と同じスタイルで」と頼んでも、その投稿を引用したり、そのスレッドで質問したりしないと bot には見えません。

### 🤖 `auto` — 将来の自動判定用（予約）

現状は **`thread` と同じ挙動** です。将来、もっと賢い判定（例:「チャネル名の命名規則から推論」）を導入する予定の予約スロットです。

### 早見表

| モード | チャネル直下の発言 | スレッド内返信 | 向いているケース |
|---|---|---|---|
| `channel`（デフォルト） | → チャネルセッション | → **チャネルセッション**（同じ会話） | 1:1 DM、小規模チーム |
| `thread` | → チャネルセッション | → スレッドセッション（新しい会話） | 話題が並走する共有チャネル |
| `auto` | (`thread` と同じ) | (`thread` と同じ) | 将来に備える |

### どれを選ぶか

| こういう使い方をしたい | 設定値 |
|---|---|
| 「シンプルに。1チャネル = 1会話。」 | `channel`（または未設定） |
| 「自分の質問と他の人の質問が混ざってほしくない。」 | `thread` |
| 「先のことは開発者に任せる。妥当なデフォルトを使う。」 | `auto` |

### モード切替は安全?

粒度を変えても **既存のセッションは削除されません**。これから来る新しいメッセージの振り分け方が変わるだけで、過去の会話は MulmoClaude の UI にそのまま残ります。

ただし `channel` → `thread` に切り替えると、それまで 1 本のチャネルセッションに蓄積されていたメッセージは、以後スレッド内返信が来ると新しいスレッドセッションとして作られます。古いチャネルセッションの文脈は自動では新セッションに引き継がれません。

---

## 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `SLACK_BOT_TOKEN` | はい | `xoxb-...` Bot User OAuth Token |
| `SLACK_APP_TOKEN` | はい | `xapp-...` App-Level Token (`connections:write`) |
| `SLACK_ALLOWED_CHANNELS` | いいえ | アクセスを許可するチャネル ID の CSV（空ならすべて許可） |
| `SLACK_SESSION_GRANULARITY` | いいえ | `channel`（デフォルト） / `thread` / `auto`。上記参照 |
| `MULMOCLAUDE_API_URL` | いいえ | デフォルト `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | いいえ | Bearer token（未指定ならワークスペースから自動取得） |

## ライセンス

MIT
