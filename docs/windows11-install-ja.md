# Windows 11でMulmoClaudeを30分で動かす完全ガイド

## はじめに

このガイドは、MulmoClaudeを初めて使う方のためのインストールガイドです。

Windows 11を利用している方を対象に、必要なソフトウェアの準備から、MulmoClaudeの起動、初期設定、よくあるエラーの解決方法までを、一つひとつ順番に説明します。

専門的な知識やプログラミングの経験は必要ありません。画面の表示に沿って進めるだけで、MulmoClaudeを利用できるようになることを目標としています。

このガイドは、実際にWindows 11環境でMulmoClaudeをセットアップした経験をもとに作成しました。インストール中に発生しやすいエラーや、その解決方法についても紹介しています。

## このガイドでできること
- Windows 11に必要なソフトウェアをインストールする
- MulmoClaudeをダウンロードして起動する
- Claude CodeとGemini APIを設定する
- よくあるエラーを解決する
- MulmoClaudeを継続して利用できる環境を構築する
### 対象読者

このガイドは、次のような方を対象としています。

- MulmoClaudeを初めて利用する方
- Windows 11でAI開発環境を構築したい方
- GitやNode.jsの経験が少ない方
- できるだけ短時間でMulmoClaudeを使い始めたい方

それでは、Windows 11でMulmoClaudeを動かすための準備から始めましょう。

## 目次

- 第1章 必要なもの
- 第2章 Node.js のインストール
- 第3章 Git のインストール
- 第4章 GitHub Desktop のセットアップ
- 第5章 GitHubアカウントとFork
- 第6章 Claude Code の認証
- 第7章 Gemini API の設定
- 第8章 MulmoClaude の起動
- 第9章 Windowsショートカットの作成
- 第10章 トラブルシューティング

# 第1章　必要なもの

MulmoClaudeを快適に利用するためには、事前にいくつかのソフトウェアやアカウントを準備する必要があります。

この章では、それぞれの役割と、なぜ必要なのかを分かりやすく説明します。

---

## Windows 11

このガイドは、Windows 11（64ビット版）を対象としています。

Windows 10でも動作する場合がありますが、本ガイドではWindows 11で動作確認を行っています。

---

## Node.js（LTS版）

Node.jsは、MulmoClaudeを動かすために必要なJavaScript実行環境です。

インストールする際は、安定版である **LTS（Long Term Support）版** をおすすめします。

Node.jsをインストールすると、npm（Node Package Manager）も同時に利用できるようになります。

---

## Git

Gitは、ソースコードの管理や更新を行うためのソフトウェアです。

MulmoClaudeをGitHubから取得したり、最新版へ更新したり、オープンソースへ貢献（Pull Request）したりするために使用します。

---

## GitHubアカウント

GitHubアカウントは、MulmoClaudeのソースコードを取得したり、IssueやPull Requestを作成したりするために必要です。

オープンソースへ参加するための入口となります。

---

## GitHub Desktop

GitHub Desktopは、Gitを分かりやすく操作できるWindows用アプリケーションです。

コマンド操作に慣れていない方でも、

- Clone
- Commit
- Push
- Pull Request

などを画面操作だけで行えます。

本ガイドでもGitHub Desktopを利用して説明します。

---

## Claude Pro

MulmoClaudeでは、Claude Codeを利用するためにClaudeアカウントが必要です。

本ガイドでは、Claude Proを利用したセットアップ手順を紹介します。

---

## Gemini APIキー

Gemini APIキーは、一部のAI機能を利用するために必要です。

Google AI Studioで取得し、`.env` ファイルへ設定します。

なお、APIキーは第三者へ公開しないよう十分注意してください。

---

## Visual Studio Code

Visual Studio Code（VS Code）は、設定ファイルやMarkdownファイルを編集するために使用します。

本ガイドでは、Windows版VS Codeを利用して説明します。

---

## この章で準備するもの

次のものがそろえば、MulmoClaudeをセットアップする準備が整います。

- Windows 11
- Node.js（LTS）
- Git
- GitHubアカウント
- GitHub Desktop
- Claude Pro
- Gemini APIキー
- Visual Studio Code

それでは、次章から実際のインストールを始めましょう。

# 第2章　Node.js のインストール

MulmoClaudeは、Node.js上で動作するアプリケーションです。

そのため、最初にNode.jsをインストールします。

この章では、Windows 11へNode.js（LTS版）をインストールする手順を説明します。

---

## Node.jsとは

Node.jsは、JavaScriptをパソコン上で実行するための環境です。

MulmoClaudeをはじめ、多くのAI開発ツールはNode.jsを利用して動作しています。

安定して利用するため、本ガイドでは **LTS（Long Term Support）版** の利用をおすすめします。

---

## インストール手順

### 1. Node.js公式サイトを開く

ブラウザで次のページを開きます。

https://nodejs.org/

---

### 2. LTS版をダウンロード

表示されている **LTS版** をダウンロードします。

Current版ではなく、LTS版を選択してください。

---

### 3. インストーラーを実行

ダウンロードしたインストーラーを起動します。

基本的には、すべて既定（Next）で問題ありません。

途中で

```
Add to PATH
```

が有効になっていることを確認してください。

---

### 4. インストール完了

インストールが完了したら、Windowsを再起動することをおすすめします。

---

## インストールの確認

PowerShellを開き、次のコマンドを実行します。

```powershell
node -v
```

バージョン番号が表示されれば成功です。

例

```text
v24.6.0
```

続いて、

```powershell
npm -v
```

を実行します。

こちらもバージョン番号が表示されれば正常です。

例

```text
11.5.1
```

---

## よくあるエラー

### node が見つかりません

```
'node' は内部コマンドまたは外部コマンド…
```

と表示される場合は、

- インストールが完了していない
- PATHが反映されていない

可能性があります。

Windowsを再起動してから、もう一度実行してください。

---

### npm が見つかりません

Node.jsのインストールが途中で失敗している可能性があります。

Node.jsを再インストールしてください。

---

## この章の確認

次の2つのコマンドが正常に実行できれば、この章は完了です。

```powershell
node -v
npm -v
```

それでは、次章ではGitをインストールします。