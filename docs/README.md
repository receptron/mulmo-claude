# MulmoClaude ドキュメント

## ユーザー向け / End Users

使い方や機能の説明。プログラミングの知識がなくても読めるように書いています。

| ドキュメント | 言語 | 説明 |
|---|---|---|
| [MulmoBridge ガイド](mulmobridge-guide.md) | 日本語 | メッセージアプリから自宅PCのAIと話す方法。仕組み、設定方法、ダミーサーバーの使い方 |
| [MulmoBridge Guide](mulmobridge-guide.en.md) | English | Same as above in English |
| [スケジューラー ガイド](scheduler-guide.md) | 日本語 | カレンダーと定期タスク。AIに自動で仕事をさせる方法 |
| [Scheduler Guide](scheduler-guide.en.md) | English | Same as above in English |
| [Telegram セットアップ](message_apps/telegram/README.md) | English | Telegram Bot の作成と接続手順 |
| [Telegram セットアップ](message_apps/telegram/README.ja.md) | 日本語 | 同上の日本語版 |

## 開発者向け / Developers

コードの構造、API、ビルド方法。

| ドキュメント | 言語 | 説明 |
|---|---|---|
| [Developer Guide](developer.md) | English | 環境変数、スクリプト、ワークスペース構造、CI、内部パッケージ一覧 |
| [Bridge Protocol](bridge-protocol.md) | English | MulmoBridge のワイヤープロトコル仕様（socket.io イベント、認証） |
| [Task Manager](task-manager.md) | English | サーバー内部の tick ループ + @receptron/task-scheduler との関係 |
| [Logging](logging.md) | English | ログレベル、フォーマット、ローテーション設定 |
| [Sandbox Credentials](sandbox-credentials.md) | English | Docker サンドボックスへの資格情報転送 |
| [Manual Testing](manual-testing.md) | English | E2E でカバーできない手動テスト項目 |

## プロジェクト情報 / Project

| ドキュメント | 言語 | 説明 |
|---|---|---|
| [CHANGELOG](CHANGELOG.md) | English | リリース履歴（Keep a Changelog 形式） |
| [PR紹介](PR-ja.md) | 日本語 | MulmoClaude の紹介・PR用テキスト |
| [v0.1.0 リリースノート](releases/v0.1.0.md) | English | 初回リリース |
| [v0.1.1 リ���ースノート](releases/v0.1.1.md) | English | モノレポ + ストリーミング + ブリッジ |

## パッケージ / Packages

各パッケージの README は `packages/` ディレクトリ内にあります。

| ドキュメント | 説明 |
|---|---|
| [packages/README.md](../packages/README.md) | MulmoBridge パッケージ全体像（English） |
| 各パッケージの README | npm ページに表示される個別ドキュメント |
