# 名前付き root を「読めるだけ」から使える状態にする（#3019 / #3014 順序 1.5）

#3015 で名前付き root は **読めるが書けない・生成できない**状態で入った。
#3014 の目的（デッキをリポジトリに置き、元テキストを直しながら調整し、LLM に
デザインを指示する）はそこで途切れる。MulmoTerminal 側と突き合わせて、塞がって
いる理由を実測で分解した結果、**本当に塞がっているのは 1 箇所だけ**だった。

## 実測（推測ではなく動かして確認した）

「起動 path 1 個を root として登録した世界」を作って実行:

```
stories/myrepo/decks/talk.json -> OK  <launch>/myrepo/decks/talk.json
stories/other/notes/deck.json  -> OK  <launch>/other/notes/deck.json
stories/../../etc/passwd       -> 拒否 bad_request
launch/artifacts が生えた?      -> false（副作用なし）
```

root は**プロジェクト単位ではなくサブツリー**で、任意段のネストが読める。だから
#3014 の「起動している path 以下が見えるのが理想」は **root 1 個**で足りる。

| 経路 | root 対応の現状 | 要る作業 |
|---|---|---|
| upload（beat / character 画像） | **既に正しい** | ガードを外すだけ |
| 生成の出力（movie / PDF / beat） | **既に正しい** | ガードをホスト宣言制に |
| `save` / `updateBeat` / `updateScript` | ❌ 単一 FileOps | root ごとの FileOps |

根拠: upload は `runStoryOp` の context を使い、`buildContext(absoluteFilePath)` は
`resolveStory` の**絶対パス**を受け、`basedir` もそこから derive される。つまり
出力先は最初から名前付き root の中。`writeFileAtomic` も絶対パスを取る。

## 決めたこと

### 1. 生成ガードは「root が既定か」ではなく「ホストが鍵に root を含められるか」

fail-closed にした理由は MulmoClaude ホストのセッションストアで、`generationKey`
(`@mulmobridge/protocol`) が `(kind, filePath, key)` を鍵にすること。実測すると
使用者は `server/events/session-store/index.ts` **だけ**で、MulmoTerminal は
`chatSessionId` を捨てて pubsub に流すだけ、該当ストアを持たない。

**持っていない危険のために拒否していた。** 判定をホストの宣言に移す。

宣言が無ければ **今の挙動のまま**（拒否）。既存ホストは無改変で今の安全side に
留まり、対応したホストだけが開く。

### 2. 結果に `root` を載せる — これが無いと下流が書けない

`root` を通したのは args とイベントだけで、**結果には通していなかった**。
ホストはカードを結果から作るので、カードに root が載らない。#3014 の衝突点 3
（別 root の同名デッキが同じカードに合流）は、ホスト側の `filePathIdentity` を
直すだけでは閉じられない。

これはこの一連の作業で繰り返した形の 15 回目 —— **比較とイベントは広げたのに、
データを運ぶ経路を広げていない**。#3015 のレジャーに 14 回分書いた同じ形。

追加型（`root` 無し = 既定 root）なので既存カードは無改変。

### 3. `artifactsFor(root)` — 公開型は壊さない

塞がっているのは `dispatch.ts:98` の 1 行:

```ts
const executeContext = { files: { artifacts: ops.backend.artifacts } };  // FileOps 1 個持ちきり
```

core の executor は `context.files.artifacts` に **wire パス**（`stories/…`）を渡すだけ
なので、dispatch が root で FileOps を選べば **executor も `MulmoScriptExecuteContext`
も無改変**で済む（この型は `/core` と `/vue` の両方から export されている）。

MulmoTerminal 側の `createFileOps(rootFor: () => string, label: string)` は root getter を
取る形なので、ホスト側は root 1 個につきクロージャ 1 個。

### 4. `extraRoots` は構築時固定のまま — 実行時登録はしない

一度は「MulmoTerminal のディレクトリ一覧は実行中に変わるから thunk が要る」と
考えたが、root がサブツリーなら **起動 path 1 個**で足り、それは boot で確定する。
実行時登録は要らない。

## 不可侵点

**封じ込めは `resolveStory` 単独が担っている。** 両ホストの `writeFileAtomic` は
渡された絶対パスをそのまま信じる（MulmoTerminal `server/backends/mulmoscript.ts:66`、
`mkdir -p` して rename するだけ）。ホスト側で 2 枚目の封じ込めを書かないのは
`@mulmoclaude/core` の "security-critical primitive must not drift per consumer" に
従った判断で、正しい。**ガードを外すときにここを壊してはいけない。**

## 検証

- 名前付き root で save / update / upload / 生成が**通ること**、既定 root が無改変であること
- **未登録 root と traversal は依然として拒否**されること（封じ込めの回帰）
- ホスト宣言が無いときは生成が**今と同じく拒否**されること（既存ホストの無改変）
- 結果の `root` が往復すること
- 各ガードのリバートで赤になること

## この PR に入れないもの

- MulmoTerminal 側（`filePathIdentity` の対応、`storyWirePath()` 拡張、UI）— 順序 2
- `.mulmoterminal.json` の宣言キー — 公開スキーマは足すより消す方が難しいので、
  UI が要ると分かってから
