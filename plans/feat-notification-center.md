# Notification Center (#144)

## Overview

サーバーから Web UI / Telegram / CLI に通知を配信し、ユーザーが通知から直接
関連画面に遷移できる仕組み。インフラ (push pipeline + toast PoC) は完了済み
(#331, #318, #400, #404)。本計画は **UI + トリガー配線 + 永続化** を扱う。

---

## Notification Payload

```ts
interface NotificationPayload {
  /** Unique ID for dedup / dismiss tracking */
  id: string;
  /** Category — drives icon + default behavior */
  kind: "todo" | "scheduler" | "agent" | "journal" | "push" | "bridge";
  /** Short summary (1 line) */
  title: string;
  /** Detail text (optional, 2-3 lines max) */
  body?: string;
  /** Material icon name (default derived from kind) */
  icon?: string;
  /** What happens on click */
  action:
    | {
        type: "navigate";
        view: "todos" | "scheduler" | "files" | "chat";
        path?: string;
        sessionId?: string;
        itemId?: string;
      }
    | { type: "none" };
  /** ISO8601 — when the notification fired */
  firedAt: string;
  /** Affects badge color, sound, Browser Notification API usage */
  priority: "normal" | "high";
  /** Source session — for "open in chat" navigation */
  sessionId?: string;
  /** Bridge origin — for cross-device context */
  transportId?: string;
}
```

### kind → default icon

```ts
const NOTIFICATION_ICONS: Record<string, string> = {
  todo: "check_circle",
  scheduler: "event",
  agent: "smart_toy",
  journal: "auto_stories",
  push: "notifications",
  bridge: "chat",
};
```

---

## UI コンポーネント構成

```
TopBar
  └─ 🔔 BellButton (unread count badge)
       └─ NotificationPanel (dropdown)
            ├─ NotificationItem × N
            │   ├─ icon (kind 別)
            │   ├─ title + body
            │   ├─ timestamp (相対: "3 分前")
            │   ├─ × dismiss button
            │   └─ click → action.navigate or noop
            ├─ "Mark all read" button
            └─ empty state: "通知はありません"
```

---

## Click → Navigate フロー

```
NotificationItem click
  ├─ action.type === "none" → mark read のみ
  └─ action.type === "navigate"
       ├─ view === "chat"      → router.push(`/chat/${sessionId}`)
       ├─ view === "todos"     → router.push(`/chat?view=todos`)
       │                         + itemId があれば該当行をハイライト
       ├─ view === "scheduler" → router.push(`/chat?view=scheduler`)
       └─ view === "files"     → router.push(`/chat?view=files&path=${path}`)
       + パネルを閉じる + mark read
```

---

## ユーザーシナリオ

### シナリオ 1: Todo リマインダー → 完了操作

```
9:50 AM — サーバーが "10:00 レポート提出" の 10 分前リマインダーを発火

🔔 Bell badge: 1
├─ Web UI: toast "レポート提出 — あと 10 分" がスライドイン
├─ Telegram: "⏰ レポート提出 — あと 10 分"
└─ CLI: [notification] レポート提出 — あと 10 分

ユーザーが Web で bell をクリック:
  → NotificationPanel 開く
  → "レポート提出 — あと 10 分" をクリック
  → Todo view が開き、該当アイテムがハイライト
  → チェックして完了
```

payload:
```json
{
  "id": "todo-reminder-abc",
  "kind": "todo",
  "title": "レポート提出 — あと 10 分",
  "action": { "type": "navigate", "view": "todos", "itemId": "abc" },
  "firedAt": "2026-04-18T09:50:00Z",
  "priority": "high"
}
```

### シナリオ 2: Agent 長時間タスク完了 → 結果確認

```
ユーザーが「リポジトリの README を書き直して」と依頼して別タブへ移動

3 分後 — agent 完了

🔔 Bell badge: 1
├─ Web UI: toast "README 書き直し完了"
├─ Telegram: "✅ README 書き直し完了"

Web で bell をクリック:
  → "README 書き直し完了" をクリック
  → 該当セッションが開き、結果が表示される
```

payload:
```json
{
  "id": "agent-done-xyz",
  "kind": "agent",
  "title": "README 書き直し完了",
  "action": { "type": "navigate", "view": "chat", "sessionId": "xyz" },
  "firedAt": "2026-04-18T14:03:00Z",
  "priority": "normal",
  "sessionId": "xyz"
}
```

### シナリオ 3: スケジューラー → チャットで詳細確認

```
朝 8:55 — "9:00 朝会" の 5 分前

🔔 Bell badge: 1 (priority: high → Browser Notification API + 音)

Web の通知をクリック:
  → Scheduler view が開き、今日のアイテム一覧
  → 「朝会の議題を整理して」とチャットに入力
  → Claude が Wiki + 前回の会議メモを読んで議題をまとめる
```

payload:
```json
{
  "id": "sched-mtg-001",
  "kind": "scheduler",
  "title": "朝会 — あと 5 分",
  "action": { "type": "navigate", "view": "scheduler" },
  "firedAt": "2026-04-18T08:55:00Z",
  "priority": "high"
}
```

### シナリオ 4: 日次ジャーナル完了 → 振り返り

```
毎日 23:00 — journal daily pass が完了

🔔 Bell badge: 1 (priority: normal)

翌朝 bell をクリック:
  → "日次サマリー作成完了" をクリック
  → Files view で昨日のサマリーが表示される
  → 「今日の計画立てて」とチャットに入力
```

payload:
```json
{
  "id": "journal-2026-04-18",
  "kind": "journal",
  "title": "日次サマリー作成完了",
  "body": "conversations/summaries/daily/2026/04/18.md",
  "action": {
    "type": "navigate",
    "view": "files",
    "path": "conversations/summaries/daily/2026/04/18.md"
  },
  "firedAt": "2026-04-18T23:00:00Z",
  "priority": "normal"
}
```

### シナリオ 5: Telegram からの着信 → Web で続き

```
外出中に Telegram で「○○の調査して」と依頼 → Claude が調査完了

├─ Telegram: "✅ ○○の調査完了。Wiki に 3 ページ追加"
├─ Web UI: 🔔 badge: 1

帰宅後、Web で bell をクリック:
  → "○○の調査完了" をクリック
  → セッションが開き、Claude の調査結果が見える
  → Wiki view に切り替えて詳細を読む
```

payload:
```json
{
  "id": "agent-done-research",
  "kind": "agent",
  "title": "○○の調査完了",
  "body": "Wiki に 3 ページ追加しました",
  "action": { "type": "navigate", "view": "chat", "sessionId": "sess-abc" },
  "firedAt": "2026-04-18T15:30:00Z",
  "priority": "normal",
  "sessionId": "sess-abc",
  "transportId": "telegram"
}
```

---

## 永続化

```
~/mulmoclaude/config/notifications.json
{
  "dismissed": ["id1", "id2"],     // 明示的に消したもの
  "readAt": "2026-04-18T09:00:00Z" // この時刻以前は既読扱い
}
```

- toast 表示は ephemeral (永続化しない)
- bell badge count = `readAt` 以降 かつ `dismissed` に入っていない通知の数
- サーバー再起動で in-memory 通知はクリアされるが、永続化された
  readAt / dismissed はファイルから復元

---

## トリガー配線 (実装順)

| 優先度 | トリガー源 | 発火条件 | payload kind |
|---|---|---|---|
| P0 | agent 完了 | `session_finished` event | `agent` |
| P1 | scheduler | アイテム開始の N 分前 | `scheduler` |
| P1 | todo | due date 到来 or リマインダー時刻 | `todo` |
| P2 | journal | daily pass 完了 | `journal` |
| P3 | bridge 着信 | Telegram/CLI からメッセージ受信 | `bridge` |

P0 (agent 完了通知) は `endRun()` の中で `pushSessionEvent` の直後に
notification を publish するだけ — 最も影響が小さく、最もユーザー需要が高い。

---

## ファイル計画

| File | Kind | Purpose |
|---|---|---|
| `src/components/NotificationBell.vue` | new | Bell icon + badge + panel toggle |
| `src/components/NotificationPanel.vue` | new | Dropdown list of notifications |
| `src/components/NotificationItem.vue` | new | Single notification row |
| `src/composables/useNotifications.ts` | edit | Add payload type, navigate helper, read/dismiss state |
| `src/components/NotificationToast.vue` | edit | Use new payload (icon, action on click) |
| `server/events/notifications.ts` | edit | Payload type, trigger helpers |
| `server/events/session-store/index.ts` | edit | P0: agent 完了通知 |
| `@mulmobridge/protocol` | edit | NotificationPayload type export |

---

## Related

- #142 (external notifications) — closed, merged into this issue
- #331 (notification push scaffold) — PoC toast + test endpoint (merged)
- #318 (bridge push) — pushToBridge infrastructure (merged)
- #393, #400, #404 (text streaming) — streaming delivery (merged)
