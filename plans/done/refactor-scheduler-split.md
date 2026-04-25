# plan: split Scheduler into Calendar + Automations

Tracking: #758

## Goal

Surface Calendar and Automations as two peer menu entries with their
own routes, views, icons, and keyboard shortcuts. Remove the shared
tab bar that made Tasks a second-class citizen behind Calendar.

## Non-goals

- Backend / API changes. `/api/scheduler/*`, `SCHEDULER_ACTIONS`,
  `workspacePaths.scheduler*`, and the `manageScheduler` MCP tool
  all stay unchanged — this is a pure UI-navigation refactor.
- Per-page URL state (filters, sort order). Deferred.
- Badge counts on either icon. Deferred.
- Renaming the underlying plugin folder to match new UI names.
  Keeping `src/plugins/scheduler/` intact keeps the MCP tool-result
  rendering path simple — the top-level pages import the same
  sub-components for consistency.

## Design

### Routing

- Add `PAGE_ROUTES.calendar = "calendar"` and `PAGE_ROUTES.automations = "automations"`.
- Add routes `/calendar` and `/automations` to `src/router/index.ts`.
- Replace the existing `/scheduler` entry with a redirect to
  `/calendar` so bookmarks keep working. Removal can come later
  once telemetry shows nobody hits it.
- Drop `PAGE_ROUTES.scheduler`? No — we keep it un-used as a
  sentinel for anything still referencing it during the transition.
  Actually clean removal is simpler; check all call sites first
  (see "References to update" below).

### Page views

Two new page-level wrappers under `src/plugins/scheduler/` (same
folder to keep scheduler-domain code co-located):

- `src/plugins/scheduler/CalendarView.vue` — extracted calendar-only
  content from current `View.vue` (template lines 32–204 + calendar
  state).
- `src/plugins/scheduler/AutomationsView.vue` — thin wrapper around
  the existing `TasksTab.vue`. Renders the same component; standalone
  heading reads "Automations" via a new i18n key.

The existing `src/plugins/scheduler/View.vue` stays for tool-result
rendering context (MCP `manageScheduler` responses inside /chat).
Its tab-switcher continues to work the same way — `detectInitialTab`
already picks the right sub-view from result data shape.

### App.vue dispatch

Replace:

```vue
<SchedulerView v-else-if="currentPage === 'scheduler'" />
```

with:

```vue
<CalendarView v-else-if="currentPage === 'calendar'" />
<AutomationsView v-else-if="currentPage === 'automations'" />
```

### PluginLauncher

Replace the single entry at `src/components/PluginLauncher.vue:55`:

```ts
{ key: "scheduler", kind: "view", icon: "event" }
```

with two:

```ts
{ key: "calendar",    kind: "view", icon: "calendar_month" },
{ key: "automations", kind: "view", icon: "schedule" },
```

### Keyboard shortcuts

`src/App.vue:439–446` `PAGE_SHORTCUT_KEYS` change:

```ts
// Before
"4": PAGE_ROUTES.scheduler,

// After
"4": PAGE_ROUTES.calendar,
"9": PAGE_ROUTES.automations,
```

### i18n (8 locales lockstep per CLAUDE.md)

- Add `pluginLauncher.calendar = { label, title }` and
  `pluginLauncher.automations = { label, title }`. Titles reference
  the new shortcuts: "Open calendar (⌘4)" and "Open automations (⌘9)".
- Remove `pluginLauncher.scheduler`.
- Add `pluginAutomations.heading` (= "Automations") for the standalone
  page heading.
- Keep `pluginScheduler.*` / `pluginSchedulerTasks.*` keys as-is —
  they're still used by the combined View.vue and TasksTab.vue in
  the tool-result context. Renaming them is code churn without value.

### Role sample queries

`src/config/roles.ts:60` — replace `"Show me the scheduler"` with
two queries on the General role:

- `"Show me my calendar"`
- `"Show me my automations"`

Keeps the hint surface consistent with the two new pages.

## References to update (exhaustive)

- `src/router/index.ts` — add 2 routes, remove (or keep as redirect) `/scheduler`.
- `src/App.vue` — `PAGE_SHORTCUT_KEYS` + view dispatch + imports.
- `src/components/PluginLauncher.vue` — key union + entries list.
- `src/config/roles.ts` — General role sample queries.
- `src/plugins/scheduler/CalendarView.vue` — NEW.
- `src/plugins/scheduler/AutomationsView.vue` — NEW.
- `src/lang/{en,ja,zh,ko,es,pt-BR,fr,de}.ts` — `pluginLauncher.*` split + `pluginAutomations.heading`.
- `docs/scheduler-guide.md` / `docs/scheduler-guide.en.md` — rename page references.
- `docs/developer.md` — check for "Scheduler page" mentions.
- `e2e/tests/files-scheduler-preview.spec.ts` — existing testids
  (`scheduler-tab-calendar`/`tasks`) are used through the files-preview
  path, not the main page route; verify they still resolve against
  the combined `View.vue` in tool-result context.

## Testing

### Automated

- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` clean.
- Existing e2e passes — no test currently navigates directly to `/scheduler`.

### New e2e (optional, small)

Add a short spec `e2e/tests/calendar-automations-nav.spec.ts`:
- Click Calendar launcher → URL becomes `/calendar`, calendar view visible.
- Click Automations launcher → URL `/automations`, tasks list visible.
- ⌘4 / ⌘9 shortcuts land on the right pages from elsewhere.
- `/scheduler` redirects to `/calendar`.

Optional but cheap; adds discoverability-regression protection.

### Manual

- Navigate to `/scheduler` → should redirect to `/calendar`.
- Confirm both launchers render distinct icons.
- Confirm no dead-link on old bookmarks.
- Confirm that inside /chat, a `manageScheduler` tool result still
  renders its tab-switcher correctly (the plugin-side View.vue is
  unchanged).

## Rollout

Single PR. No feature flag needed — the change is additive on the
navigation side and redirect-preserving for legacy URLs.

## Done when

- Both icons reachable from PluginLauncher with distinct visuals.
- Direct nav to `/calendar` and `/automations` works.
- `/scheduler` redirects.
- ⌘4 / ⌘9 shortcuts work.
- i18n present in all 8 locales.
- CI green.
- PR merged.
