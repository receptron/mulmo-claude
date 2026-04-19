# MulmoClaude Documentation

## End Users

Guides for using MulmoClaude. No programming knowledge required.

| Document | Language | Description |
|---|---|---|
| [MulmoBridge ガイド](mulmobridge-guide.md) | 日本語 | メッセージアプリから自宅PCのAIと話す方法 |
| [MulmoBridge Guide](mulmobridge-guide.en.md) | English | Connect messaging apps to your home PC's AI agent |
| [スケジューラー ガイド](scheduler-guide.md) | 日本語 | カレンダーと定期タスクの使い方 |
| [Scheduler Guide](scheduler-guide.en.md) | English | Calendar and recurring tasks |
| [Telegram Setup](message_apps/telegram/README.md) | English | Create and connect a Telegram Bot |
| [Telegram セットアップ](message_apps/telegram/README.ja.md) | 日本語 | Telegram Bot の作成と接続手順 |

## Developers

Code structure, APIs, and build instructions.

| Document | Language | Description |
|---|---|---|
| [Developer Guide](developer.md) | English | Environment variables, scripts, workspace structure, CI, internal packages |
| [Bridge Protocol](bridge-protocol.md) | English | MulmoBridge wire protocol spec (socket.io events, auth) |
| [Task Manager](task-manager.md) | English | Server tick loop + @receptron/task-scheduler integration |
| [Logging](logging.md) | English | Log levels, formats, rotation |
| [Sandbox Credentials](sandbox-credentials.md) | English | Docker sandbox credential forwarding |
| [Manual Testing](manual-testing.md) | English | Manual test items not covered by E2E |

## Project

| Document | Language | Description |
|---|---|---|
| [CHANGELOG](CHANGELOG.md) | English | Release history (Keep a Changelog format) |
| [PR紹介](PR-ja.md) | 日本語 | MulmoClaude の紹介・PR用テキスト |
| [v0.1.0 Release Notes](releases/v0.1.0.md) | English | First tagged release |
| [v0.1.1 Release Notes](releases/v0.1.1.md) | English | Monorepo + streaming + bridges |

## Packages

Each package has its own README inside `packages/`.

| Document | Description |
|---|---|
| [packages/README.md](../packages/README.md) | MulmoBridge package overview |
| Individual package READMEs | Published to npm package pages |
