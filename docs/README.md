# MulmoClaude Documentation

## End Users

Guides for using MulmoClaude. No programming knowledge required.

| Document                                                    | Language | Description                                             |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------- |
| [MulmoBridge ガイド](mulmobridge-guide.md)                  | 日本語   | メッセージアプリから自宅PCのAIと話す方法                |
| [MulmoBridge Guide](mulmobridge-guide.en.md)                | English  | Connect messaging apps to your home PC's AI agent       |
| [スケジューラー ガイド](scheduler-guide.md)                 | 日本語   | カレンダーと定期タスクの使い方                          |
| [Scheduler Guide](scheduler-guide.en.md)                    | English  | Calendar and recurring tasks                            |
| [Telegram Setup](message_apps/telegram/README.md)           | English  | Create and connect a Telegram Bot                       |
| [Telegram セットアップ](message_apps/telegram/README.ja.md) | 日本語   | Telegram Bot の作成と接続手順                           |
| [LINE Setup](message_apps/line/README.md)                   | English  | Create and connect a LINE bot (requires ngrok)          |
| [LINE セットアップ](message_apps/line/README.ja.md)         | 日本語   | LINE bot の作成と接続手順 (ngrok 必要)                  |
| [Relay Setup](message_apps/relay/README.md)                 | English  | Deploy a cloud relay — no ngrok, offline queue          |
| [Relay セットアップ](message_apps/relay/README.ja.md)       | 日本語   | クラウドリレーのデプロイ — ngrok 不要、オフラインキュー |

## Tips & Integrations

| Document                                                            | Language | Description                                                                                  |
| ------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| [Obsidian 連携](tips/obsidian.md)                                   | 日本語   | MulmoClaude のワークスペースを Obsidian で閲覧、既存 vault を Claude に参照させる            |
| [Obsidian Integration](tips/obsidian.en.md)                         | English  | Browse MulmoClaude output in Obsidian, let Claude reference your vault                       |
| [Claude Code × Ollama セットアップ知見](tips/claude-code-ollama.md) | 日本語   | ローカル LLM (Ollama) で Claude Code を動かすときの context 長 / モデル選定知見              |
| [Claude Code × Ollama Setup Notes](tips/claude-code-ollama.en.md)   | English  | Running Claude Code against a local Ollama backend — context-window, model picks             |
| [Runtime Plugin デバッグ知見](tips/runtime-plugin-debugging.md)     | 日本語   | `npx mulmoclaude` で runtime plugin が呼べないときに踏んだ silent failure 4 パターンと直し方 |
| [Bedrock Deployment](bedrock-deployment.en.md)                      | English  | Run MulmoClaude against Anthropic Claude on AWS Bedrock                                      |
| [Bedrock デプロイ](bedrock-deployment.md)                           | 日本語   | AWS Bedrock 経由の Anthropic Claude で動かす手順                                             |

## Architecture & Design

| Document                                                          | Language | Description                                                                                                        |
| ----------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| [Memory](memory.md)                                               | English  | Topic-based memory store under `conversations/memory/` — schema, agent read/write contract, atomic→topic migration |
| [Runtime Plugins](plugin-runtime.md)                              | English  | Workspace-installed runtime plugins (#1043 C-2) — install, dispatch, asset routes, collisions                      |
| [Bridge Session Design](bridge-session-design.md)                 | English  | Session identification, caching, and multi-user scaling plan                                                       |
| [Image-path Routing — Research](image-path-routing.md)            | English  | Read-only audit of how the LLM's image references become browser-loadable URLs                                     |
| [Image-path Routing — 設計議論](discussion-image-path-routing.md) | 日本語   | 画像パスのルーティング再設計の議論メモと段階的実装計画                                                             |
| [Wiki / HTML 表示サーフェス](wiki-html-render-surfaces.md)        | 日本語   | Wiki / HTML / Markdown が表示される複数箇所の差異 (権限・画像パス解決) を整理                                      |

## Developers

Code structure, APIs, and build instructions.

| Document                                      | Language | Description                                                                                                                         |
| --------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [Developer Guide](developer.md)               | English  | Environment variables, scripts, workspace structure, CI, internal packages                                                          |
| [UI Cheatsheet](ui-cheatsheet.md)             | English  | ASCII layouts of every major UI surface, anchored to component / `data-testid` names so chat / PR text can reference them precisely |
| [Bridge Protocol](bridge-protocol.md)         | English  | MulmoBridge wire protocol spec (socket.io events, auth)                                                                             |
| [Task Manager](task-manager.md)               | English  | Server tick loop + @receptron/task-scheduler integration                                                                            |
| [Logging](logging.md)                         | English  | Log levels, formats, rotation                                                                                                       |
| [Sandbox Credentials](sandbox-credentials.md) | English  | Docker sandbox credential forwarding                                                                                                |
| [Manual Testing](manual-testing.md)           | English  | Manual test items not covered by E2E                                                                                                |

## Project

| Document                                   | Language | Description                               |
| ------------------------------------------ | -------- | ----------------------------------------- |
| [CHANGELOG](CHANGELOG.md)                  | English  | Release history (Keep a Changelog format) |
| [PR紹介](PR-ja.md)                         | 日本語   | MulmoClaude の紹介・PR用テキスト          |
| [v0.1.0 Release Notes](releases/v0.1.0.md) | English  | First tagged release                      |
| [v0.1.1 Release Notes](releases/v0.1.1.md) | English  | Monorepo + streaming + bridges            |

## Packages

Each package has its own README inside `packages/`.

| Document                                    | Description                    |
| ------------------------------------------- | ------------------------------ |
| [packages/README.md](../packages/README.md) | MulmoBridge package overview   |
| Individual package READMEs                  | Published to npm package pages |
