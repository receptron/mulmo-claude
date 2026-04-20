# MulmoClaude + Obsidian 連携ガイド

MulmoClaude のワークスペースは全てプレーンな Markdown ファイルで構成されています。[Obsidian](https://obsidian.md/) はローカルの Markdown ファイルをそのまま扱うナレッジ管理ツールなので、**コード変更なし・プラグイン不要**で連携できます。

---

## パターン A: MulmoClaude のファイルを Obsidian で閲覧する

Claude が作成したドキュメント、Wiki ページ、メモリ、TODO などを Obsidian のグラフビューや検索で探索できます。

### セットアップ

1. Obsidian を開く
2. 「Open folder as vault」(フォルダを Vault として開く) を選択
3. `~/mulmoclaude/` を指定

以上です。Obsidian が `.obsidian/` ディレクトリを作成しますが、MulmoClaude 側には影響しません。

### 見えるファイル

```
~/mulmoclaude/
  data/wiki/pages/*.md        ← Wiki ページ（Claude が蓄積した知識ベース）
  data/wiki/index.md          ← Wiki インデックス
  conversations/memory.md     ← Claude の長期記憶
  conversations/summaries/    ← 日次サマリー
  artifacts/documents/*.md    ← Claude が作成したドキュメント
```

### 活用例

- **グラフビュー**: Wiki ページ間の `[[wiki link]]` がそのまま Obsidian のリンクとして認識され、知識のつながりを視覚化できる
- **全文検索**: Obsidian の高速検索で、Claude との過去の会話結果やドキュメントを横断的に探せる
- **タグ・フォルダ管理**: Obsidian 側でタグやスター付けしても、Claude の動作に影響しない
- **モバイル同期**: Obsidian Sync や iCloud/Dropbox で `~/mulmoclaude/` を同期すれば、スマホから Claude の出力を閲覧できる

### 注意点

- Obsidian でファイルを編集すると、Claude も変更後の内容を読みます。意図的でない限り、Obsidian 側では閲覧のみにすることを推奨します
- `.obsidian/` ディレクトリは `.gitignore` に追加しておくと良いでしょう

---

## パターン B: 既存の Obsidian Vault を Claude に参照させる

既に Obsidian で管理しているノートやドキュメントを Claude に読ませたい場合。

### 方法 1: 非 Docker モード（最も簡単）

`DISABLE_SANDBOX=1` で MulmoClaude を起動すると、Claude はファイルシステム全体にアクセスできます。チャットで Vault のパスを伝えるだけです。

```
~/ObsidianVault/projects/ にあるノートを読んで、要約して
```

Claude は内蔵のファイルツール (`read`, `glob`, `grep`) で Vault 内のファイルを直接読み取ります。

### 方法 2: Docker モード — ワークスペース設定で参照ディレクトリを追加

Settings (歯車アイコン) → Workspace Dirs タブで Obsidian Vault のパスを追加できます。Docker sandbox 内では read-only でマウントされるため、Claude がファイルを書き換える心配はありません。

### 方法 3: Wiki の ingest 機能でインポート

Obsidian のノートを MulmoClaude の Wiki に取り込むこともできます。

```
~/ObsidianVault/research/ にあるノートを wiki にインポートして
```

Claude がノートを読み、知識を整理して Wiki ページとして保存します。元の Obsidian ファイルは変更されません。

### どの方法を選ぶ？

| 方法 | Docker 対応 | 書き込み保護 | セットアップ |
|------|------------|------------|-------------|
| 非 Docker + パス指示 | ❌ | ❌ (プロンプトのみ) | なし |
| ワークスペース設定 | ✅ | ✅ (read-only mount) | Settings UI |
| Wiki ingest | ✅ | ✅ (コピー) | なし |

---

## 双方向で使う

パターン A + B を組み合わせると:

1. Obsidian で普段のノート管理をする
2. Claude に Obsidian のノートを参照させて質問・分析・要約する
3. Claude の出力（Wiki、ドキュメント）を Obsidian で閲覧・検索する

`[[wiki link]]` 記法が共通なので、Claude が作った Wiki ページと Obsidian のノートがシームレスにつながります。

---

## FAQ

**Q: Obsidian の `.obsidian/` フォルダが邪魔にならない？**

A: なりません。MulmoClaude はこのディレクトリを無視します。`.gitignore` に追加しておくと git 管理上もクリーンです。

**Q: `[[wiki link]]` の形式は互換性がある？**

A: はい。MulmoClaude の Wiki も Obsidian も `[[ページ名]]` 形式を使います。Obsidian のグラフビューでリンク構造がそのまま表示されます。

**Q: Claude が Obsidian のノートを書き換えてしまわない？**

A: Docker モード + ワークスペース設定を使えば、read-only mount により物理的に書き換え不可能です。非 Docker モードではプロンプトによる制限のみなので、重要なファイルがある場合は Docker モードを推奨します。
