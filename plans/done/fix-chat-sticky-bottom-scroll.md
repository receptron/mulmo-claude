# fix(chat): 読んでいる最中に自動スクロールで流れないようにする

Issue: receptron/mulmoclaude#2179

## 問題

`src/composables/useChatScroll.ts` の `latestResultScrollKey` に `last?.message?.length` が含まれるため、
ストリーミングで文字が追記されるたびに watch が発火し、**無条件**に `scrollTop = scrollHeight` していた。
ユーザーが上へスクロールして読んでいても毎チャンク最下部へ引き戻される。

`src/components/StackView.vue` の watch（同じ `latestResultScrollKey` パターン）も同様。

「最下部付近か」を判定するロジックはコードベースに存在しなかった。

## 方針（Slack / Discord 風 sticky-bottom）

**初期状態は追従ON。ユーザーが上へスクロールしたときだけ追従OFF、最下部へ戻れば再開。**

この既定にすることで、既存の回帰テスト（ストリーミング中にスクロールが発火することを保証）も従来どおり通る。
「追記されると勝手に動く」のは強制 `scrollTop` が原因であり、ビューポートより下への追記自体は表示位置を動かさない。

## 実装

- `src/utils/dom/scrollable.ts`
  - `NEAR_BOTTOM_THRESHOLD_PX`（許容幅 = 「最下部からチョイ上」）
  - `isNearBottom(element, thresholdPx)` — 純粋関数、テスト可能
- `src/composables/useStickToBottom.ts`（新規・共有）
  - 要素の `scroll` を購読し `stuck` を更新。既定 `true`、`resume()` で再武装。
  - `getCurrentInstance()` ガード付きで `onBeforeUnmount` に解除を登録（テストからの直接呼び出しでも警告を出さない）。
- `src/composables/useChatScroll.ts`
  - `scrollChatToBottom({ force })` に変更。`force` でなければ `stuck` が false のときスキップ。
  - ストリーミング watch はゲート経由。
  - `isRunning → true`（= 送信によるターン開始 = 明示操作）は `resume()` + `force` で必ず最下部へ。
- `src/components/StackView.vue`
  - `onContainerScroll` の抑制ガードより**前**で `stickToBottom` を更新（ユーザー操作もカードジャンプも反映）。
  - ストリーミング watch の自動スクロール（bottom / card 両分岐）をゲート。
  - サイドバークリック等の明示ナビゲーションの `scrollIntoView` はゲートしない。

## テスト

- `test/utils/dom/test_scrollable.ts` — `isNearBottom` の境界（ちょうど閾値 / 閾値+1 / 最下部 / 最上部）
- `test/composables/test_useChatScroll.ts`
  - 既存の回帰テスト（ストリーミングで追従）を維持
  - 上へスクロール後はストリーミングで**スクロールしない**
  - 最下部へ戻すと**追従が再開**する
  - `isRunning → true` は追従OFFでも**強制的に最下部へ**

## スコープ外（issue に残す）

- 「新着 ↓」未読アフォーダンス（i18n 8ロケール + UI が必要）
- StackView の iframe 高さ変化によるビューポート上側のズレ補正（`overflow-anchor`）
