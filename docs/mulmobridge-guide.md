# MulmoBridge ガイド — メッセージアプリから自宅PCのAIと話す

## MulmoBridge とは？

あなたの自宅PCには、AI エージェント（Claude や GPT など）が動いています。文書を作ったり、スケジュールを管理したり、Wiki に知識をまとめたり。でも、あなたはいつも PC の前にいるわけではありません。

**MulmoBridge** は、スマホの **Telegram** や **LINE**、**Slack** などのメッセージアプリから、自宅 PC の AI エージェントに安全にメッセージを送り、返答を受け取るための仕組みです。

```
あなたのスマホ                          自宅のPC
┌──────────────┐                    ┌─────────────────────┐
│  Telegram     │                   │  MulmoBridge        │
│  LINE         │  ── メッセージ ──→ │    ↓                │
│  Slack        │                   │  AIエージェント      │
│  Discord      │  ←── 返答 ──────  │  (Claude, GPTなど)  │
│  ...          │                   │    ↓                │
└──────────────┘                    │  あなたのファイル    │
                                    └─────────────────────┘
```

写真や PDF を送ることもできます。AI が画像を見て答えたり、文書を読んで要約したりできます。

---

## なぜパッケージとして分離しているの？

MulmoBridge は元々 [MulmoClaude](https://github.com/receptron/mulmoclaude) の一部でしたが、「メッセージアプリとの接続」という機能は MulmoClaude 以外でも使えるべきだと考え、独立したパッケージとして切り出しました。

**分離のメリット:**

1. **どのAIツールでも使える** — MulmoClaude に限らず、OpenAI の API を直接使うアプリや、LangChain ベースのツール、自作のエージェントでも接続できます
2. **好きなメッセージアプリだけ使える** — Telegram だけ使いたい人は Telegram パッケージだけインストールすればOK
3. **MIT ライセンス** — 商用利用含め自由に使えます（MulmoClaude 本体は AGPL ですが、ブリッジ部分は MIT です）
4. **開発がしやすい** — 各パッケージが小さく独立しているので、新しいメッセージアプリへの対応が簡単に追加できます

---

## MulmoClaude での使い方

MulmoClaude は Web ブラウザで AI と対話するアプリですが、MulmoBridge を使うと外出先からも AI に指示を出せます。

### 基本的な流れ

1. **自宅 PC で MulmoClaude を起動する** (`yarn dev`)
2. **ブリッジを起動する** — 使いたいメッセージアプリに対応するブリッジを1つ起動
3. **スマホからメッセージを送る** — 普段使いのメッセージアプリで AI と会話

### 何ができるの？

- 外出先から「今日のタスクを教えて」と聞く
- 写真を送って「この書類を要約して」と頼む
- 「明日の会議の資料を作っておいて」と指示する
- Wiki に保存した情報を「先月の出張レポートどこだっけ？」と検索する
- スケジュールの確認や追加

### CLI ブリッジで試す（一番簡単）

ターミナルから直接 AI と会話できます。セットアップ不要で一番手軽です。

```bash
# MulmoClaude を起動した状態で
npx @mulmobridge/cli@latest
```

### Telegram ブリッジで試す

1. [@BotFather](https://t.me/BotFather) で Bot を作成してトークンを取得
2. Bot に話しかけて Chat ID を確認（[@userinfobot](https://t.me/userinfobot) で取得可能）
3. ブリッジを起動:

```bash
TELEGRAM_BOT_TOKEN=your-bot-token \
TELEGRAM_ALLOWED_CHAT_IDS=your-chat-id \
  npx @mulmobridge/telegram@latest
```

詳しい設定: [Telegram README](https://github.com/receptron/mulmoclaude/blob/main/packages/telegram/README.md)

---

## 対応プラットフォーム一覧

| プラットフォーム | パッケージ | 状態 | 設定の詳細 |
|---|---|---|---|
| **ターミナル (CLI)** | [@mulmobridge/cli](https://www.npmjs.com/package/@mulmobridge/cli) | 安定 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/cli/README.md) |
| **Telegram** | [@mulmobridge/telegram](https://www.npmjs.com/package/@mulmobridge/telegram) | 安定 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/telegram/README.md) |
| **Discord** | [@mulmobridge/discord](https://www.npmjs.com/package/@mulmobridge/discord) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/discord/README.md) |
| **Slack** | [@mulmobridge/slack](https://www.npmjs.com/package/@mulmobridge/slack) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/slack/README.md) |
| **LINE** | [@mulmobridge/line](https://www.npmjs.com/package/@mulmobridge/line) | 動作確認済み | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/line/README.md) |
| **WhatsApp** | [@mulmobridge/whatsapp](https://www.npmjs.com/package/@mulmobridge/whatsapp) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/whatsapp/README.md) |
| **Matrix** | [@mulmobridge/matrix](https://www.npmjs.com/package/@mulmobridge/matrix) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/matrix/README.md) |
| **IRC** | [@mulmobridge/irc](https://www.npmjs.com/package/@mulmobridge/irc) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/irc/README.md) |
| **Mattermost** | [@mulmobridge/mattermost](https://www.npmjs.com/package/@mulmobridge/mattermost) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/mattermost/README.md) |
| **Zulip** | [@mulmobridge/zulip](https://www.npmjs.com/package/@mulmobridge/zulip) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/zulip/README.md) |
| **Facebook Messenger** | [@mulmobridge/messenger](https://www.npmjs.com/package/@mulmobridge/messenger) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/messenger/README.md) |
| **Google Chat** | [@mulmobridge/google-chat](https://www.npmjs.com/package/@mulmobridge/google-chat) | 実験的 | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/google-chat/README.md) |

> **「実験的」とは？** テストが十分でなく、バグがある可能性があります。フィードバックをお待ちしています！

---

## ダミーサーバーで試してみよう

MulmoClaude をインストールしなくても、**ダミーサーバー** を使えばブリッジの動作を確認できます。ダミーサーバーは送ったメッセージをそのまま返す（エコー）だけのシンプルなサーバーです。

### ステップ 1: ダミーサーバーを起動

```bash
npx @mulmobridge/mock-server@latest
```

起動すると、接続用のトークンが表示されます（デフォルト: `mock-test-token`）。

### ステップ 2: ブリッジを接続

別のターミナルを開いて:

```bash
# CLI ブリッジ（一番簡単）
MULMOCLAUDE_AUTH_TOKEN=mock-test-token npx @mulmobridge/cli@latest

# Telegram ブリッジ
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
TELEGRAM_BOT_TOKEN=your-bot-token \
TELEGRAM_ALLOWED_CHAT_IDS=your-chat-id \
  npx @mulmobridge/telegram@latest
```

メッセージを送ると `[echo] あなたのメッセージ` と返ってきます。スラッシュコマンド（`/help`, `/roles`, `/status`）も試せます。

ダミーサーバーの詳細: [mock-server README](https://github.com/receptron/mulmoclaude/blob/main/packages/mock-server/README.md)

---

## 開発者向け: 自分のツールで MulmoBridge を使う

MulmoBridge は MulmoClaude 専用ではありません。あなたの AI アプリにも組み込めます。

### アーキテクチャ

```
メッセージアプリ  ←→  ブリッジ  ←→  chat-service  ←→  あなたのAIエージェント
  (Telegram等)      (@mulmobridge/   (@mulmobridge/     (何でもOK)
                      telegram等)      chat-service)
```

3つの層に分かれています:

1. **protocol** — メッセージの形式を定義する型と定数
2. **chat-service** — Express サーバーに組み込む socket.io サービス
3. **ブリッジ** — メッセージアプリと chat-service をつなぐ小さなプログラム

### 最小実装例

```typescript
import express from "express";
import { createServer } from "http";
import { createChatService } from "@mulmobridge/chat-service";

const app = express();
const server = createServer(app);

const chatService = createChatService({
  // あなたの AI エージェント
  startChat: async ({ text }) => {
    const reply = await myAgent.run(text);
    return { reply };
  },
  // 最小限の設定（詳細は chat-service の README を参照）
  onSessionEvent: () => {},
  loadAllRoles: async () => [{ id: "default", name: "Assistant" }],
  getRole: async () => ({ id: "default", name: "Assistant" }),
  defaultRoleId: "default",
  transportsDir: "/tmp/transports",
  logger: console,
});

app.use(chatService.router);
chatService.attachSocket(server);
server.listen(3001);
// → これで Telegram, Slack, CLI 等のブリッジから接続できる！
```

### 新しいブリッジを作る

既存のメッセージアプリ以外にも対応したい場合、ブリッジは ~100 行で書けます:

```typescript
import { createBridgeClient } from "@mulmobridge/client";

const client = createBridgeClient({ transportId: "my-app" });

// メッセージを受けたら AI に転送
const ack = await client.send(chatId, userText);
if (ack.ok) {
  await replyToUser(chatId, ack.reply);
}
```

詳しくは [Bridge Protocol](bridge-protocol.md) を参照してください。TypeScript 以外（Python, Go など）でも socket.io 4.x クライアントがあれば実装できます。

---

## パッケージ全体像

### メッセージング（@mulmobridge スコープ）

| パッケージ | 説明 | ソース |
|---|---|---|
| [@mulmobridge/protocol](https://www.npmjs.com/package/@mulmobridge/protocol) | プロトコル型定義・定数 | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/protocol) |
| [@mulmobridge/chat-service](https://www.npmjs.com/package/@mulmobridge/chat-service) | サーバー側 chat サービス | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/chat-service) |
| [@mulmobridge/client](https://www.npmjs.com/package/@mulmobridge/client) | ブリッジ側クライアント | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/client) |
| [@mulmobridge/mock-server](https://www.npmjs.com/package/@mulmobridge/mock-server) | テスト用ダミーサーバー | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/mock-server) |
| [@mulmobridge/cli](https://www.npmjs.com/package/@mulmobridge/cli) | CLI ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/cli) |
| [@mulmobridge/telegram](https://www.npmjs.com/package/@mulmobridge/telegram) | Telegram ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/telegram) |
| [@mulmobridge/discord](https://www.npmjs.com/package/@mulmobridge/discord) | Discord ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/discord) |
| [@mulmobridge/slack](https://www.npmjs.com/package/@mulmobridge/slack) | Slack ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/slack) |
| [@mulmobridge/line](https://www.npmjs.com/package/@mulmobridge/line) | LINE ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/line) |
| [@mulmobridge/whatsapp](https://www.npmjs.com/package/@mulmobridge/whatsapp) | WhatsApp ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/whatsapp) |
| [@mulmobridge/matrix](https://www.npmjs.com/package/@mulmobridge/matrix) | Matrix ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/matrix) |
| [@mulmobridge/irc](https://www.npmjs.com/package/@mulmobridge/irc) | IRC ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/irc) |
| [@mulmobridge/mattermost](https://www.npmjs.com/package/@mulmobridge/mattermost) | Mattermost ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/mattermost) |
| [@mulmobridge/zulip](https://www.npmjs.com/package/@mulmobridge/zulip) | Zulip ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/zulip) |
| [@mulmobridge/messenger](https://www.npmjs.com/package/@mulmobridge/messenger) | Facebook Messenger ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/messenger) |
| [@mulmobridge/google-chat](https://www.npmjs.com/package/@mulmobridge/google-chat) | Google Chat ブリッジ | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/google-chat) |

### 汎用ツール（@receptron スコープ）

| パッケージ | 説明 | ソース |
|---|---|---|
| [@receptron/task-scheduler](https://www.npmjs.com/package/@receptron/task-scheduler) | 永続化対応タスクスケジューラー | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/scheduler) |

---

## フィードバック募集中！

新しいブリッジ（Discord, Slack, LINE, WhatsApp, Matrix, IRC）はまだ十分にテストできていません。

- **試してくれた方**: [Issue](https://github.com/receptron/mulmoclaude/issues/new) で教えてください！動いた・動かなかった、どちらの報告も助かります
- **バグを見つけた方**: `--verbose` オプション（ダミーサーバー）のログを貼ってもらえると原因特定しやすいです
- **新しいプラットフォームが欲しい方**: Issue でプランを提案してください。貢献の流れは [developer.md](../docs/developer.md) を参照

GitHub: https://github.com/receptron/mulmoclaude
npm: https://www.npmjs.com/org/mulmobridge
