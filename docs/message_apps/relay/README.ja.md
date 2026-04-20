# MulmoBridge Relay — ngrok なしでスマホから使う

English: [`README.md`](README.md)

---

## Relay って何？

LINE や Slack、Messenger で MulmoClaude を使うとき、これらのサービスはあなたのパソコンにメッセージを送る必要があります。通常は **ngrok** という、パソコンに一時的な公開 URL を作るツールが必要です。問題は、ngrok を再起動するたびに URL が変わり、LINE の開発者コンソールで毎回書き換えなければならないこと。

**Relay** はこの問題を解決します。クラウド（Cloudflare Workers）上に小さなサーバーを置き、**固定 URL** を持ちます。LINE がメッセージを Relay に送り、Relay がそれを安全な WebSocket 接続であなたのパソコンに転送します。パソコンがオフのときはメッセージをキューに入れ、オンラインに戻ったら届けます。

```text
あなたのスマホ (LINE/Telegram)
     ↓ メッセージ
Relay (クラウド、固定URL)
     ↓ WebSocket (暗号化)
あなたのパソコン (MulmoClaude)
     ↓
Claude が応答
     ↓
Relay → LINE/Telegram → あなたのスマホ
```

### ビフォー・アフター

| | 従来（ngrok） | Relay 導入後 |
|---|---|---|
| 公開 URL | 再起動のたびに変わる | 固定（一度設定すれば変わらない） |
| 再起動時の作業 | URL をコピーして LINE コンソールに貼り直し | 不要 |
| パソコンがオフ | メッセージ消失 | メッセージをキューに保持 |
| ngrok | 必要 | 不要 |
| 複数プラットフォーム | それぞれ別プロセスで起動 | 1つの Relay で全部受信 |

---

## 必要なもの

1. **Cloudflare アカウント**（無料）— [こちらから登録](https://dash.cloudflare.com/sign-up)
2. **Node.js 20 以上**がパソコンにインストール済み
3. **MulmoClaude** が動いている状態（`yarn dev`）
4. **メッセージアプリの Bot**が作成済み（LINE Bot、Telegram Bot など）

> **料金**: Cloudflare Workers の無料枠は 1日 10万リクエスト — 個人利用には十分です。Relay が使う Durable Objects は本番運用では Workers Paid プラン（月$5）が必要ですが、無料枠でテストできます。

---

## セットアップ手順

### ステップ 1: Cloudflare CLI をインストール

```bash
npm install -g wrangler
```

### ステップ 2: Cloudflare にログイン

```bash
wrangler login
```

ブラウザが開きます。Cloudflare アカウントでログインして、Wrangler を承認してください。

### ステップ 3: Relay をデプロイ

```bash
cd packages/relay
wrangler deploy
```

以下のような出力が表示されます：

```
Published mulmobridge-relay
  https://mulmobridge-relay.あなたの名前.workers.dev
```

**この URL を保存してください** — これがあなたの固定 Relay アドレスです。

### ステップ 4: 認証トークンを設定

このトークンは Relay と MulmoClaude の間の認証に使います。あなたのパソコンだけが接続できるようにするためです。

```bash
wrangler secret put RELAY_TOKEN
```

強いランダムなパスワードを入力してください。**忘れないでください** — ステップ 6 でも使います。

### ステップ 5: メッセージアプリを設定

#### LINE の場合

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

LINE Developers Console の値を入力します。

次に、LINE の Webhook URL を以下に変更：

```
https://mulmobridge-relay.あなたの名前.workers.dev/webhook/line
```

#### Telegram の場合

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

次に、Telegram の Bot API で Webhook を設定：

```bash
curl "https://api.telegram.org/bot<ボットトークン>/setWebhook?url=https://mulmobridge-relay.あなたの名前.workers.dev/webhook/telegram&secret_token=<Webhookシークレット>"
```

### ステップ 6: MulmoClaude を Relay に接続

MulmoClaude の `.env` ファイルに追加：

```dotenv
RELAY_URL=wss://mulmobridge-relay.あなたの名前.workers.dev/ws
RELAY_TOKEN=ステップ4で設定したのと同じトークン
```

MulmoClaude を起動：

```bash
yarn dev
```

### ステップ 7: テスト！

LINE や Telegram からメッセージを送ってみてください。MulmoClaude のサーバーログにメッセージが表示され、Claude の応答がチャットアプリに届くはずです。

---

## 複数のプラットフォームを同時に使う

Relay は LINE と Telegram を同時に扱えます。ステップ 5 で両方のシークレットを設定し、両方の Webhook URL を登録するだけです。すべてのプラットフォームからのメッセージが 1本の WebSocket で届きます。

設定済みのプラットフォームを確認：

```bash
curl https://mulmobridge-relay.あなたの名前.workers.dev/health
```

応答：

```json
{ "status": "ok", "platforms": { "line": true, "telegram": true } }
```

---

## パソコンがオフのとき

メッセージは Relay に保存されます（最大 1,000 件）。パソコンが再接続すると、キューに溜まったメッセージが自動的に届きます。何もする必要はありません。

---

## セキュリティ

| レイヤー | 保護 |
|---|---|
| スマホ → Relay | LINE: HMAC-SHA256 署名検証。Telegram: シークレットトークンヘッダー |
| Relay → パソコン | 暗号化された WebSocket (wss://) + bearer トークン |
| Cloudflare | DDoS 保護、TLS 証明書（自動） |
| アクセス制御 | あなたのパソコンだけが接続可能（同時接続1台まで） |

メッセージは Cloudflare のネットワークを経由します。通信中は暗号化（TLS）され、パソコンがオフラインの間は Durable Object に一時保存されます。保存されたメッセージは配信後に削除されます。長期保存はしません。

---

## トラブルシューティング

### "LINE not configured"（404）と表示される

LINE のシークレットがまだ設定されていません：

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

### メッセージが届かない

1. health エンドポイントを確認 — あなたのプラットフォームが `true` になっていますか？
2. MulmoClaude のサーバーログを確認 — relay 接続のメッセージが出ていますか？
3. `.env` の `RELAY_URL` と `RELAY_TOKEN` が正しいか確認

### Webhook で "Unauthorized"（401）

Webhook の署名検証に失敗しています。`LINE_CHANNEL_SECRET`（または `TELEGRAM_WEBHOOK_SECRET`）が、プラットフォームの開発者コンソールの値と一致しているか確認してください。

### パソコンが再接続してもキューのメッセージが届かない

キューは最大 1,000 件です。オフライン中に 1,000 件を超えるメッセージが届いた場合、古いものから削除されます。

---

## Relay のアップデート

新しいバージョンがリリースされたら：

```bash
cd packages/relay
git pull origin main
wrangler deploy
```

シークレットは保持されます — 再入力の必要はありません。

---

## Claude Code でガイド付きセットアップ

MulmoClaude 内で Claude Code を使っている場合、対話的にセットアップを実行できます：

```
/setup-relay
```

Claude が各ステップを案内します — 前提条件の確認、Relay のデプロイ、シークレットの設定、MulmoClaude との接続まで。ブラウザ操作が必要なコマンド（`wrangler login` など）は `!` プレフィックスでユーザーのターミナルで実行します。
