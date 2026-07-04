# Git for Windows インストールガイド

## はじめに

このガイドでは、Windows 11にGit for Windowsをインストールし、PowerShellから `git --version` で確認できる状態にするまでを説明します。
---

## Gitとは

Gitは、プログラムやドキュメントの変更履歴を管理するためのソフトウェアです。

変更前の状態へ戻したり、複数人で安全に共同作業したりできます。

このガイドでは、MulmoClaudeの開発で必要となるGitをインストールします。

---
## インストール手順

### 1. Git公式サイトを開く

ブラウザーで次のページを開きます。

<https://git-scm.com/>
![Git公式サイト](images/git-for-windows-ja/git-home.png)
### 2. Git for Windows をダウンロード

「Download for Windows」をクリックします。

### 3. インストーラーを実行

ダウンロードしたインストーラーを起動します。

![Gitセットアップ開始](images/git-for-windows-ja/git-installer.png)

基本的には、すべて既定（Next）のままで問題ありません。そのまま「Next」をクリックして進めてください。

### 4. インストールを開始

**Install** をクリックしてインストールを開始します。

![Gitインストール開始](images/git-for-windows-ja/git-install.png)

### 5. インストール完了

インストールが完了すると次の画面が表示されます。

![Gitインストール完了](images/git-for-windows-ja/git-install-finish.png)
「Launch Git Bash」と「View Release Notes」はどちらもチェックを外したまま **Finish** をクリックします。

このガイドでは Git Bash は使用せず、PowerShell と VS Code のターミナルを使用します。

---

## この章の確認

PowerShell を開き、次のコマンドを実行します。

```powershell
git --version
```

バージョン番号が表示されれば成功です。

例

```text
git version 2.54.0.windows.1
```

それでは、次章では Visual Studio Code（VS Code）をインストールします。
