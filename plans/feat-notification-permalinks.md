# feat: deep-link notifications to their target item (permalinks)

Issue: [#762](https://github.com/receptron/mulmoclaude/issues/762)

## Problem

The notification bell currently drops the user onto the feature's index view — a `files` notification goes to `/files` and a `scheduler` notification goes to `/scheduler`, ignoring any identifier on the payload. `NotificationAction` declares `path` and `itemId` fields, but `resolveNotificationTarget` never reads them, and only `push` (source ingest) is published at all. Five of the six declared `NotificationKind`s are never emitted.

Result: the user can't jump straight to the todo card / scheduled task / source feed / tool result a notification refers to — they always land on the index and have to hunt.

## Scope — what this PR does

1. **Router**: add permalink routes for the features that currently only support an index URL:
   - `/todos/:itemId`
   - `/automations/:taskId` (scheduled tasks live on the Automations page after the #758 split)
   - `/sources/:slug`
2. **Types**: replace the generic `path` / `itemId` / `sessionId` trio on `NotificationAction` with an explicit, discriminated-union `target` per view. The old shape is not load-bearing yet (only one publisher uses it, and the dispatcher ignores the extras), so migrating is safe.
3. **Dispatcher** (`src/utils/notification/dispatch.ts`): return a richer `NotificationTarget` that carries params. `App.vue#handleNotificationNavigate` pushes them into `router.push`.
4. **Page components**: consume the new params so landing on `/todos/:itemId` highlights+scrolls the item, `/scheduler/tasks/:taskId` switches to the Tasks tab and scrolls to the row, `/sources/:slug` selects the feed. When the param is absent, behaviour is unchanged (index view).
5. **Push publisher**: rewire `server/workspace/sources/pipeline/notify.ts` to emit a deep-link target — single-article case points at the specific source feed; batch case keeps pointing at the index.
6. **Tests**: unit coverage for `resolveNotificationTarget` across every target variant; E2E that fires a notification, clicks it in the bell, and asserts the resulting URL.

## Explicitly out of scope

- **Emitting notifications from the five currently-silent publishers** (todo / scheduler / agent / journal / bridge). That's a separate follow-up issue per kind — the framework wiring in this PR makes those publishers drop-in ready, but each one needs product-side decisions (user settings, throttling) that don't belong in a plumbing PR.
- **Wiki heading anchors** — browsers already handle `#heading` hash navigation via native fragment links. No router changes needed; if we want notifications to target a wiki heading, the publisher just sets `target: { view: "wiki", slug, anchor: "heading-slug" }` and the dispatcher appends `#heading-slug`. Keep noted but not implemented until a publisher actually wants it.
- **NotificationToast click handling** — it's currently dismiss-only. Making toasts navigable is a separate UX decision; keep it out of this PR.

## Design

### NotificationAction — before

```ts
type NotificationAction =
  | { type: "navigate"; view: NotificationView; path?: string; sessionId?: string; itemId?: string }
  | { type: "none" };
```

### NotificationAction — after

```ts
type NotificationTarget =
  | { view: "chat"; sessionId: string; resultUuid?: string }
  | { view: "todos"; itemId?: string }
  | { view: "calendar" } // index-only; no per-event deep-link yet
  | { view: "automations"; taskId?: string }
  | { view: "sources"; slug?: string }
  | { view: "files"; path?: string }
  | { view: "wiki"; slug?: string; anchor?: string };

type NotificationAction =
  | { type: "navigate"; target: NotificationTarget }
  | { type: "none" };
```

Every existing publisher sets only `{ view, maybe-one-id }` today, so this rewrite is a narrowing refactor, not a behaviour change. Publishers that want index-only nav pass `target: { view: "files" }` with no `path`.

### Dispatcher

`resolveNotificationTarget(action)` returns:
```ts
type ResolvedTarget =
  | { kind: "push"; to: RouteLocationRaw }   // direct router.push payload
  | null;
```

One-liner per view to build the matching `RouteLocationRaw` using `PAGE_ROUTES` constants.

### Page components — responsibilities

| Page | New param | Behaviour when present |
|---|---|---|
| TodosView | `itemId` | Scroll + highlight the matching card. No-op if the id doesn't exist (board might have been edited). |
| AutomationsView (Scheduler / TasksTab) | `taskId` | Already forces `activeTab = "tasks"`; additionally scroll to row with matching id. |
| SourcesView | `slug` | Select the feed (opens its per-feed panel if the UI has one; otherwise scrolls + flashes the row). |

All three treat a missing / unknown id as "just render the index" — the URL stays canonical but nothing blocks the user.

## Verification

### Unit tests

- `test/utils/notification/test_dispatch.ts` — cover every target variant (including unknown view fallback → null, and `chat` without sessionId → null).

### E2E

- `e2e/tests/notifications.spec.ts` (new) — seed a notification via the pubsub mock for each kind, open the bell, click, assert the current URL matches the expected permalink.

### Manual testing

- Start the app, let the sources pipeline run, confirm clicking the resulting notification opens the specific feed (not just `/sources`).

## Execution order

1. Plan doc (this file) committed first.
2. Type refactor in `src/types/notification.ts` + adapter in `resolveNotificationTarget`. TSC fails everywhere that used `action.path` / `action.itemId` — fix each fallout in one commit.
3. Add new routes in `src/router/index.ts`.
4. Wire each page to its new param.
5. Rewire `notify.ts` to the new target shape.
6. Tests.
7. Format / lint / typecheck / build clean run, then PR.
