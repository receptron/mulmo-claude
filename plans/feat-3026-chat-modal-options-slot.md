# CollectionChatModal に、ホストが差し込める `options` slot を開ける (#3026)

## 問題

`CollectionChatModal` は `fixed inset-0` + `backdrop-blur-sm` で画面全体を覆う。ホストが
「このチャットは何で立ち上がるか」をどこか別の場所に描いていても、**押すまさにその瞬間だけ
ぼかされて見えない**。

MulmoTerminal はコレクション発のチャットを 5 種のエージェント（Claude / Codex / Antigravity /
Grok / Muse）のいずれかで起こす。グローバルに永続化された 1 つの値が効くので、「コレクション
から始めたら Claude ではなく Muse が立ち上がった。なぜ？」という報告が実際に出た
（receptron/mulmoterminal#1938）。ホスト側はオーバーレイとペインのヘッダに選択 UI を出したが
（receptron/mulmoterminal#1940）、この modal が開いている間はそれが覆われる。

## 変更

### 1. `CollectionChatModal.vue` — フッターに `options` slot

キャンセル / 開始 の左。`mr-auto` を持つラッパで包む。slot が空ならラッパは幅 0 になり、
`mr-auto` はフッターの `justify-end` が既に吸っていた余白を吸うだけなので、**ボタンは動かない**。

plugin はホストが何を置くかを知らない。エージェントの語彙は持ち込まない。

### 2. `CollectionView.vue` — `chat-modal-options` を、標準経路でだけ転送

```vue
<template v-if="!sendTextMessage" #options><slot name="chat-modal-options" /></template>
```

`sendTextMessage` があるときは chat カードの中で、`submitChat` は**今動いているセッション**へ
送る（`useCollectionChat` の `dispatchSeed`）。新しいチャットは起きないので、「どのチャットが
始まるか」を選ばせるコントロールは何も変えない。**効かないオプションは、無いより悪い。**

`sendTextMessage` の存在を「chat の中にいる」シグナルとして使うのは既存の約束
（`CollectionView.vue` の props コメント）で、新しい規則ではない。

## slot 名

issue では `chat-modal-lead` を仮に置いたが `chat-modal-options` にした。「どこに座るか」では
なく「そこに何が属するか」を言う名前のほうが、API として長持ちする。

## 検証

- `test/components/test_collection_chat_modal_slot.ts`（新規）— このリポジトリに Vue の
  component unit test の基盤は無いので、`test_stackview_googlemap_wiring.ts` と同じ
  ソース解析型の guard。slot の存在・転送・gate が同じ template 要素に載っていることを固定する。
- `e2e/tests/collection-chat-button.spec.ts` に 1 行追加 — MulmoClaude では
  フッターのボタンが 2 つのままであること。**この変更が MulmoClaude から見えない**ことが、
  そもそも足せた理由なので、それを固定する。
- `yarn format` → `lint` → `typecheck` → `build`

## この PR に含めないもの

- **バージョン bump と ChangeLog** — このリポジトリでは `chore(release):` が別コミットで行う
  （`e00a578cf` 等）。publish 後に MulmoTerminal 側が上げる。
- **`CollectionRecordModal` 側の record チャット** — 同じ判断が当てはまるが、まずは要求のある
  ほうだけ。
