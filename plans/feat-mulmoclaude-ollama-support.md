# feat: MulmoClaude × Ollama（ローカル LLM）対応

## ステータス

**調査のみ。実装は未着手。**

このプランは、MulmoClaude 本体をローカル Ollama バックエンドで使えるようにする場合の必要作業をまとめたもの。現状動くのは `claude` CLI 単体での Ollama 接続のみ（`.claude/skills/setup-ollama-local/SKILL.md` および `docs/tips/claude-code-ollama.md` 参照）。

## 背景 / なぜ難しいか

MulmoClaude は Anthropic API を直接叩いていない。サーバが **`claude` CLI を子プロセスとして spawn** し（[server/agent/index.ts](../server/agent/index.ts)）、stream-json を stdin/stdout で受け渡す構造。ここから 2 つの制約が発生する:

1. **モデル指定は `claude` のデフォルト依存**。[server/agent/config.ts の `buildCliArgs`](../server/agent/config.ts) は `--model` を渡していない。
2. **バックエンド指定は親プロセスの env 依存**。MulmoClaude を通常起動した場合、env はクラウド Claude のデフォルト設定。

ローカル Ollama を end-to-end で動かすには、spawn される CLI の `--model` フラグと env の両方をローカル向けにする必要がある。Docker sandbox モードは追加で問題があり、env が container に伝わらず、container 内から `localhost:11434` ではホストの Ollama が見えない（`host.docker.internal` の追加が必須）。

UX 上の問題も継承される: 検証で動作確認できた最軽量モデル `qwen3.5:9b` でも MacBook Air M4 32GB で **初回 10 分超**、2 回目以降 1〜3 分。MulmoClaude の chat UI はインタラクティブ前提なのでユーザー体験は厳しい。実装する場合は最低限このトレードオフを明示する必要がある。

## ゴール

設定または env でローカル Ollama バックエンドにオプトインできるようにし、`claude` の spawn（通常モード／Docker sandbox 両方）が指定モデルでローカルにルーティングされる状態にする。クラウド利用は引き続きデフォルトで、デグレなし。

## 実装ティア

作業は 3 段階に分けられる。明確な需要がない限り Tier 2 で止めるのを推奨。

### Tier 1: env と CLI フラグのパススルー（50〜100 行、半日）

パワーユーザーが起動時の env でバックエンドを切り替えられる最小実装。**設定の唯一のソースは `process.env`**。`settings.json` 連携は Tier 2 で扱う（永続化と UI が必要になるため、Tier 1 で持ち込むと完了基準が曖昧になる）。これは既存の `GEMINI_API_KEY` の取り回しと同じパターン。

- [server/system/env.ts](../server/system/env.ts): `ollamaBaseUrl?`、`ollamaModel?` を追加（または `llmProvider: "cloud" | "ollama"` のような discriminator）。`process.env` から読み込み。
- [server/agent/config.ts](../server/agent/config.ts):
  - `buildCliArgs`: ローカルモード時に `"--model", ollamaModel` を追加。
  - `buildDockerSpawnArgs`: ローカルモード時に `-e ANTHROPIC_AUTH_TOKEN=ollama -e ANTHROPIC_API_KEY= -e ANTHROPIC_BASE_URL=http://host.docker.internal:11434` と `--add-host host.docker.internal:host-gateway`（Linux/Mac）を追加。
- [server/agent/index.ts](../server/agent/index.ts) の `spawnClaude`: ローカルモード時に `env: { ...process.env, ANTHROPIC_* }` を渡す（非 Docker パスは自動継承、Docker パスは上記の `-e` で対応）。

完了基準 = `OLLAMA_MODEL=qwen3.5:9b OLLAMA_BASE_URL=http://localhost:11434 npm run dev` のように env を渡して起動するとローカル接続される。

### Tier 2: 設定 UI と接続テスト（300〜500 行、2〜3 日）— **推奨**

オプションを発見可能にし、ある程度安全にする。

Tier 1 に追加で:

- [server/system/config.ts](../server/system/config.ts): settings スキーマに `llm` オブジェクトを追加（例: `{ provider: "cloud" | "ollama", ollamaBaseUrl?, ollamaModel? }`）。優先順位は **env > settings.json > デフォルト（cloud）**。env が未設定なら settings.json を読み、どちらも未設定ならクラウドにフォールバック。
- [`src/components/`](../src/components/) 配下に新しい Vue セクション（既存設定ペインと並べる）。プロバイダのラジオボタン、base URL 入力（デフォルト `http://localhost:11434`）、モデル選択ドロップダウン。
- `GET /api/settings/ollama/models` ルート: `GET <baseUrl>/v1/models` をプロキシしてリストを返す。ドロップダウン用。
- `POST /api/settings/ollama/test` ルート: 最小限の `/v1/messages` リクエストを投げ、`{ ok, kvSize, contextLength, error? }` を返す。「接続テスト」ボタン用。
- i18n: 新しい文字列はすべて 8 ロケール（`src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts`）に同時追加。CLAUDE.md の i18n ルール参照。
- chat ヘッダーにステータスインジケータを表示（**Cloud** vs **Ollama (モデル名)**）。アクティブバックエンドが曖昧にならないように。
- UI 上に警告コピー: 速度トレードオフと、tool calling に依存する MulmoClaude プラグイン/スキルがローカルモデルでは不安定であること。
- テスト:
  - Unit: env パース、settings の round-trip、両モードでの CLI args 構築（既存の `test/agent/test_agent_config.ts` 風カバレッジ）。
  - E2E: `localhost:11434` をモックする fixture で設定 UI フロー + 「接続テスト」パスを検証。

### Tier 3: プロダクション仕上げ（1000+ 行、1〜2 週間）

以下はすべてオプション。ローカルバックエンドを first-class なストーリーにする場合のみ着手する価値あり。

- **タイムアウト調整**: `provider === "ollama"` 時に SSE / agent ループのタイムアウトを延長し、Claude Code のデフォルト 10 分タイムアウトで初回が落ちないようにする。
- **起動時 warmup**: ローカルモード時、サーバ起動直後に `/v1/messages` で `"hello"` を送り KV cache を温めてからユーザーターンに入る。
- **クラウドフォールバック**: Ollama down / モデル無し検知時にクラウドに自動フォールバック（バナー付き）するか、明確な actionable error を表示。
- **プラグイン/スキル互換フラグ**: tool-use 形式に依存するプラグインのリストを保持し、ローカルモードでは無効化（または UI で警告）。
- **推奨モデルチェック**: 保存時に選択モデルを allowlist（thinking ブロックを正しく処理できることが確認された qwen3.5+、MoE バリアント等）と照合し、未検証なら警告。
- **進捗表示**: Ollama のログストリームをパースし、chat UI に「プロンプト処理中 X/Y トークン」のヒントを表示。10 分かかる理由をユーザーに見せる。
- **ドキュメント**: [docs/developer.md](../docs/developer.md)、[README.md](../README.md)、`packages/` 配下の README 翻訳を更新。

## オープンクエスチョン

- `provider` をロール単位にする（例: `general` ロールはクラウド、`local-fast` ロールは Ollama）か、グローバル設定にするか。
- Docker sandbox モードでローカル Ollama をサポートすべきか。`host.docker.internal` を通すと container の隔離性が下がるので、「ローカル Ollama は sandbox 無効時のみ」という割り切りもあり得る。
- 設定ファイルの場所: `llm` セクションは既存の `settings.json` に入れるか、メインファイルが膨らむのを避けて新しい `llm.json` に分けるか。

## Non-Goals

- OpenAI 等、Anthropic 互換でないバックエンドのサポート。スコープ外。別の抽象化が必要になる。
- ローカルモデルのパフォーマンス改善。Ollama / ハードウェアの問題で、MulmoClaude 側の関心ではない。
- 完全なプロバイダ抽象化レイヤー。Claude Code の Anthropic 互換 env 仕様に乗っかる方針を意図的に選択している。

## 参考

- 検証知見（日本語）: [`docs/tips/claude-code-ollama.md`](../docs/tips/claude-code-ollama.md)
- 検証知見（英語）: [`docs/tips/claude-code-ollama.en.md`](../docs/tips/claude-code-ollama.en.md)
- セットアップスキル（Claude Code 単体向け）: [`.claude/skills/setup-ollama-local/SKILL.md`](../.claude/skills/setup-ollama-local/SKILL.md)
- Ollama Claude Code integration: https://docs.ollama.com/integrations/claude-code
