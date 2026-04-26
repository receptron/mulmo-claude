# refactor: split `manageScheduler` MCP tool into `manageCalendar` + `manageAutomations`

Issue: [#824](https://github.com/receptron/mulmoclaude/issues/824)
Predecessor (page-side split): PR #758

## Problem

PR #758 split the **Scheduler page** into `/calendar` and `/automations` so each page has a single purpose. The chat-side **MCP tool** `manageScheduler` did not follow:

- One tool name carries 8 actions across two unrelated domains (calendar events vs. automated tasks).
- The chat tool-result card in `src/plugins/scheduler/View.vue` still renders a Calendar/Tasks tab bar — users land on the wrong tab and assume their `createTask` failed.
- The LLM has to read a single `definition.ts` prompt that mixes both domains; misrouting risk goes up.

The user-facing fix is to make tool name = single domain. Page side is the source of truth, chat side follows.

## Scope (option A from #824)

Land in one PR:

1. Replace one tool with two:
   - `manageCalendar` — actions `show / add / update / delete`
   - `manageAutomations` — actions `createTask / listTasks / deleteTask / runTask`
2. Each plugin renders its dedicated view in chat, with no tab bar. `CalendarView` and `AutomationsView` already exist (added by PR #758 for the page side); plumb the chat tool result into them via the new plugin entries.
3. The legacy `View.vue` tab UI becomes unused — remove it and the `forceTab` prop the page side used to silence the tab bar.
4. Backend `/api/scheduler` is untouched. The server already routes per action via `TASK_ACTIONS` set, so the same endpoint handles both new tools.
5. Code references in fixtures, tests, e2e demo, and roles config are renamed.

## Out of scope

- Backend route renaming (`/api/scheduler` → `/api/calendar` + `/api/automations`). Possible future cleanup, not required for the chat UX fix. Keeping one route also makes the migration trivial for any out-of-tree consumers.
- The `manageScheduler` alias for backwards compatibility — see Migration below; we go with a clean cut.

## File plan

| Path | Change |
|---|---|
| `src/plugins/scheduler/calendarDefinition.ts` | New — calendar-only tool definition |
| `src/plugins/scheduler/automationsDefinition.ts` | New — automation-only tool definition |
| `src/plugins/scheduler/definition.ts` | Delete (replaced by the two above) |
| `src/plugins/scheduler/index.ts` | Export `manageCalendarPlugin` + `manageAutomationsPlugin`; each plugin uses the matching definition and view component |
| `src/plugins/scheduler/View.vue` | Stay — CalendarView / AutomationsView still delegate to it via `force-tab`. The tab-bar UI block becomes dead code (every mount now sets `forceTab`), but ripping the tab logic out is a bigger internal refactor. Defer to a follow-up cleanup PR. |
| `src/tools/index.ts` | Replace `manageScheduler: schedulerPlugin` with `manageCalendar: ..., manageAutomations: ...` |
| `src/config/toolNames.ts` | Replace `manageScheduler` constant with two |
| `src/config/roles.ts` | Replace `"manageScheduler"` in every `availablePlugins` with both new names |
| `server/agent/plugin-names.ts` | Replace `SchedulerDef` entries (in `TOOL_ENDPOINTS` + `PLUGIN_DEFS`) with the two new defs, both pointing at `API_ROUTES.scheduler.base` |
| `src/utils/filesPreview/schedulerPreview.ts` | Rename to `calendarPreview.ts`, change `toolName` to `manageCalendar` (the items.json is calendar items only) |
| `test/utils/test_schedulerPreview.ts` | Rename file + update assertion |
| `test/utils/tools/test_result.ts` | Update `manageScheduler` literal in the fixture (split into two cases or pick one — see test) |
| `e2e/demo/agent-scripts.ts` | BEAT_2 uses `toolName: "manageScheduler"` with action `createTask` → switch to `manageAutomations` |
| `docs/CHANGELOG.md` | Note the rename in the next release entry |

## Migration / backwards compatibility

Existing chat sessions in users' workspaces have `manageScheduler` tool calls baked into their jsonl history. After the rename:

- The toolCallHistory sidebar still shows the literal "manageScheduler" name (rendered from the jsonl entry) — fine.
- The tool-result card lookup goes through `getPlugin(toolName)`. After the rename, `getPlugin("manageScheduler")` returns null and the tool-result card won't render the rich view for historical entries.
- Trade-off: a one-line `manageScheduler: manageCalendarPlugin` alias in `src/tools/index.ts` would keep historical sessions rendering their last-known result. Cost: the new plugin's "I'm rendering an old generic result, not necessarily my domain" assumption pollutes both new plugins.

**Decision (revised)**: shape-dispatching legacy view. Adds:

- `src/plugins/scheduler/legacyShape.ts` — pure helper `isLegacyAutomationsShape(data)` checking for any of `task` / `tasks` / `triggered` / `deleted`. Calendar shape is the default (anything not matching).
- `src/plugins/scheduler/LegacySchedulerView.vue` — picks `AutomationsView` or `CalendarView` based on the helper, forwards `selectedResult` and `updateResult`.
- `src/plugins/scheduler/index.ts` exports `legacyManageSchedulerEntry: PluginEntry` (deliberately not a full `ToolPlugin` — no `execute`, no `isEnabled` — so the absence makes its view-only nature explicit).
- `src/tools/index.ts` registers it under the `manageScheduler` key. `getPlugin("manageScheduler")` returns this entry and historical sessions render the rich view.

The legacy entry is **not** exposed to the LLM:
- `src/config/toolNames.ts` does not list `manageScheduler`.
- `server/agent/plugin-names.ts`'s `PLUGIN_DEFS` does not include it, so it never reaches MCP.
- No role's `availablePlugins` lists it.

So fresh chat sessions cannot pick `manageScheduler`; the entry exists strictly to render persisted history.

Tests: `test/plugins/scheduler/test_legacyShape.ts` pins the shape detector across calendar / automation / unknown / null / array / adjacent-but-different-key cases.

## Verification

- `yarn typecheck` — all types updated; the `TOOL_NAMES` consumer side catches any missed reference.
- `yarn test` — schedulerPreview / tools/test_result tests updated.
- `yarn test:e2e` — finance demo BEAT_2 must keep passing; it now exercises `manageAutomations`.
- Manual: `yarn dev`, ask agent to "make a calendar event for tomorrow at 10" (should use `manageCalendar`), then "schedule a daily task that runs ls" (should use `manageAutomations`). Chat result cards render the matching view directly with no tab bar.

## Execution order

1. Plan doc (this file) committed first.
2. New definitions + plugin entries.
3. Delete obsolete `View.vue` + `definition.ts`.
4. Update registries: tool-names, plugins, roles, server plugin-names.
5. Rename schedulerPreview → calendarPreview.
6. Update tests + e2e demo + CHANGELOG.
7. Format / lint / typecheck / build / test clean. Push, open PR.
