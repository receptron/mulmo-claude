# Plan: Top-Page UI Regression E2E Tests

> Origin: PR #620 (closed — navigation overhaul made it obsolete)
> Regression checklist: PR #529 comment (16 categories)

## Background

PR #620 implemented 16 categories / 30 tests for top-page UI regression.
It was closed because a large navigation refactor was in progress:

- `/history` route 昇格 (`feat(history): promote session history to /history route`)
- Wiki パスベース URL (`feat(wiki): move URL schema from query params to paths`)
- Files パスベース URL (`feat(files): path-based URL (/files/<path>)`)
- Logo クリックで最新チャット再開 (`feat(ui): make MulmoClaude logo/title click resume latest chat`)
- レイアウトとルーティングの分離 (`refactor: split layout preference from page routing`)
- セッション作成ロジック改善（非チャットページからのロール切替対応等）

ナビゲーション改修が落ち着いたので、不足分のテストを追加する。

## Coverage Analysis

PR #529 の 16 カテゴリのうち、既存テストの状態:

| # | カテゴリ | 状態 | 既存テストファイル |
|---|---|---|---|
| 1 | 新規セッション → 送信 → 応答 | **済** | `chat-flow.spec.ts`, `router-navigation.spec.ts` |
| 2 | セッション切り替え | **済** | `session-switching.spec.ts`, `chat-flow.spec.ts` |
| 3 | URL 直打ち / リロード | **済** | `router-navigation.spec.ts` |
| 4 | Back/Forward | **済** | `router-navigation.spec.ts`, `history-panel.spec.ts` |
| 5 | Canvas View 切替 | **済** | `keyboard-shortcuts.spec.ts`, `plugin-launcher.spec.ts` |
| 6 | Tool Result 表示 | **部分的** | `chat-flow.spec.ts` に基本のみ |
| 7 | Todo / Scheduler / Wiki | **済** | `todo-*.spec.ts`, `wiki-*.spec.ts` 等 |
| 8 | 通知クリック遷移 | **未** | — |
| 9 | Streaming auto-scroll | **済** | `streaming-autoscroll.spec.ts` |
| 10 | Multi-tab 同期 | **未** | — |
| 11 | Gemini 警告バナー | **未** | — |
| 12 | 背景生成インジケータ | **未** | — |
| 13 | API エラー | **済** | `fetch-error-surfaces.spec.ts` |
| 14 | Session not found | **済** | `router-navigation.spec.ts` |
| 15 | Arrow Key ナビゲーション | **未** | — |
| 16 | History ドロワー | **済** | `history-panel.spec.ts` |

**対象: 6 カテゴリ (6, 8, 10, 11, 12, 15) + data-testid 追加**

## Implementation Plan

### Phase 1: data-testid 属性追加

不足している testid をコンポーネントに追加する。

#### 1-1. `src/App.vue`

Gemini 警告バナーに testid を追加:

- Single mode: `data-testid="gemini-warning"`
- Stack mode: `data-testid="gemini-warning-stack"`

#### 1-2. `src/components/SessionTabBar.vue`

バッジに testid を追加:

- アクティブセッションバッジ: `data-testid="active-session-badge"`
- 未読セッションバッジ: `data-testid="unread-session-badge"`

#### 1-3. `src/components/ToolResultsPanel.vue` / `src/components/StackView.vue`

結果カードは sidebar (`ToolResultsPanel.vue`) と stack mode (`StackView.vue`) の両方でレンダリングされる。testid は両方に追加する:

- 個別結果カード (`ToolResultsPanel.vue` + `StackView.vue`): `data-testid="tool-result-{uuid}"`
- Thinking インジケータ (`ToolResultsPanel.vue`): `data-testid="thinking-indicator"`
- ステータスメッセージ (`ToolResultsPanel.vue`): `data-testid="status-message"`
- 保留中ツール呼出し (`ToolResultsPanel.vue`): `data-testid="pending-call-{toolUseId}"`

### Phase 2: E2E テスト作成

各カテゴリごとに独立した spec ファイルを作成する（既存の粒度に合わせる）。

#### 2-1. Tool Result 表示 (#6) — `e2e/tests/tool-result-display.spec.ts`

既存 `chat-flow.spec.ts` は tool_call イベントの発火のみ検証。
追加するテスト:

| テスト | 検証内容 |
|---|---|
| tool result が sidebar に表示される | `tool-result-{uuid}` カードの存在 + テキスト内容 |
| result クリックで `?result=` が URL に付く | URL query パラメータ同期 |
| result に `ring-2` ハイライトが付与される | 選択状態のスタイル |

Mock: `mockAllApis` + `page.routeWebSocket()` で socket.io pubsub をモックし `tool_result` イベントを publish

#### 2-2. 通知クリック遷移 (#8) — `e2e/tests/notification-navigation.spec.ts`

| テスト | 検証内容 |
|---|---|
| Todo 通知クリック → `/todos` に遷移 | `notification-item-*` クリック → URL が `/todos` |
| Session 通知クリック → 該当セッションに遷移 | `action.view === "chat"` + `action.sessionId` → URL が `/chat/:id` |
| Scheduler 通知クリック → `/scheduler` に遷移 | `action.view === "scheduler"` → URL 確認 |

Mock: `page.routeWebSocket()` で socket.io `/ws/pubsub` をモックし、`PUBSUB_CHANNELS.notifications` に通知ペイロードを publish。
`useNotifications()` → `usePubSub()` → socket.io 経路で受信される。
既存 testid: `notification-bell`, `notification-panel`, `notification-item-{id}`
参考: `chat-flow.spec.ts`, `streaming-autoscroll.spec.ts` の `page.routeWebSocket()` パターン

#### 2-3. Multi-tab 同期 (#10) — `e2e/tests/multi-tab-sync.spec.ts`

> 現状 `BroadcastChannel` / `crossTabSenders` は未実装（issue #205 で計画中）。
> このテストは **skip** マーカー付きで骨格のみ作成し、実装後に有効化する。

| テスト (skip) | 検証内容 |
|---|---|
| Tab A で送信 → Tab B に反映 | 2 ページ間で pub/sub イベント到達 |

代替として、**同一タブ内**で socket.io 再接続後にセッション状態が復元されることを検証するテストを追加する。

#### 2-4. Gemini 警告バナー (#11) — `e2e/tests/gemini-warning.spec.ts`

| テスト | 検証内容 |
|---|---|
| Single mode で Gemini 必要ロール選択 → 警告表示 | `gemini-warning` が visible |
| Stack mode で Gemini 必要ロール選択 → 警告表示 | `gemini-warning-stack` が visible |
| Gemini 不要ロールでは警告が出ない | どちらの testid も非表示 |

Mock: `/api/health` で `geminiAvailable: false`、`/api/roles` で `needsGemini` 判定に該当するロール（`generateImage` を含むロール）を返す

#### 2-5. 背景生成インジケータ (#12) — `e2e/tests/background-generation.spec.ts`

| テスト | 検証内容 |
|---|---|
| `generation_started` → thinking indicator 表示 | `thinking-indicator` が visible |
| `generation_started` → status message 表示 | `status-message` にテキスト |
| `generation_started` → pending call 表示 | `pending-call-{toolUseId}` が visible |
| `generation_completed` → インジケータ消滅 | 上記 3 要素が非表示 |

Mock: `page.routeWebSocket()` で socket.io `/ws/pubsub` をモックし、per-session channel に `generationStarted` / `generationFinished` イベントを publish。
`eventDispatch.ts` が `session.pendingGenerations` を更新する経路を通る。
参考: `chat-flow.spec.ts`, `streaming-autoscroll.spec.ts` の既存 websocket モックパターン

#### 2-6. Arrow Key ナビゲーション (#15) — `e2e/tests/arrow-key-navigation.spec.ts`

| テスト | 検証内容 |
|---|---|
| sidebar focus + ArrowDown → 次の result 選択 | `?result=` が変更 + `ring-2` クラス付与 |
| sidebar focus + ArrowUp → 前の result 選択 | `?result=` が変更 + `ring-2` クラス付与 |
| canvas focus + ArrowDown → スクロール | `scrollTop` が増加 |
| 編集可能要素にフォーカス → Arrow Key は無効 | input にフォーカス中は副作用なし |

Mock: `mockAllApis` + 複数 `tool_result` を含むセッション。
`useKeyNavigation` の `activePane` を制御するため sidebar/main のクリックで pane を切り替え。

### Phase 3: CI 確認

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` pass
- `yarn test:e2e` で新規テスト全 pass

## File Structure (new/modified)

```text
e2e/tests/
  tool-result-display.spec.ts       (new — #6)
  notification-navigation.spec.ts   (new — #8)
  multi-tab-sync.spec.ts            (new — #10, mostly skip)
  gemini-warning.spec.ts            (new — #11)
  background-generation.spec.ts     (new — #12)
  arrow-key-navigation.spec.ts      (new — #15)

src/App.vue                         (modified — testid 追加)
src/components/SessionTabBar.vue    (modified — testid 追加)
src/components/ToolResultsPanel.vue (modified — testid 追加)
src/components/StackView.vue        (modified — testid 追加)
```

## Decisions

- **ファイル粒度**: 元 PR #620 は 1 ファイルにまとめていたが、既存テストの粒度に合わせてカテゴリ別 spec に分割する → **確定**
- **Multi-tab 同期**: `BroadcastChannel` 未実装のため skip 付き骨格のみ → **確定**
- **PR 分割**: Phase 1 (data-testid 追加) は別 PR で先行する。Phase 2 (E2E テスト) はその後の PR で実装する → **確定**

## Notes

- Gemini 警告テストは `needsGemini()` の判定ロジック (`src/utils/role/plugins.ts`) に依存 — mock roles に `generateImage` を含める必要あり
- リアルタイム系テスト (#6, #8, #12) はすべて socket.io websocket (`/ws/pubsub`) ベース — SSE ではない。既存の `page.routeWebSocket()` パターン (`chat-flow.spec.ts`, `streaming-autoscroll.spec.ts`) に準拠する
- 背景生成テストは `pendingGenerations` のイベント形式に依存 — `eventDispatch.ts` の `generationStarted` / `generationFinished` を参照
