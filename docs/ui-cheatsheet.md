# UI Cheatsheet — ASCII layouts anchored to component / testid names

A quick visual reference so chat instructions about UI ("the bell at the top right has stale state") can be unambiguous without screenshots. Names in `[brackets]` are real `data-testid` values from the source — so you can `grep -rn 'data-testid="<name>"' src/` to jump to the rendering site, and `gh pr review` comments can reference them in plain text.

## Conventions

- `[name]` — a real `data-testid` you can grep for.
- `<Component>` — a Vue component name (also greppable: `grep -rn 'name: "Component"' src/` or import sites).
- `(:route)` — the URL route the surface lives under.
- ASCII art captures **layout intent**, not pixels. Animation, hover state, exact spacing, and CSS regressions are out of scope — use a screenshot for those.
- This file goes **out of date as the UI evolves**. When you change a layout or rename a testid, update the matching block here in the same PR. Treat it like CHANGELOG entries — small, mechanical updates per PR keep the doc honest.

## Top-level chrome (every route)

```
┌─[App.vue root]────────────────────────────────────────────────────────┐
│ ┌─[#header]────────────────────────────────────────────────────────┐  │
│ │  ⌂[Go to latest chat / brand]  🔓lock_open  🔔[notification-bell]│  │
│ │                                              ⚙ settings          │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│ ┌─<PluginLauncher> [plugin-launcher]──────────────────────────────┐   │
│ │ ✓Todos │📅Calendar │⏰Actions │📖Wiki │📡Sources │🧠Skills │🎭Roles│📁Files│   │
│ │ [plugin-launcher-todos] [plugin-launcher-calendar] ...          │   │
│ └─────────────────────────────────────────────────────────────────┘   │
│ ┌─[main pane — route-specific]────┐ ┌─<SessionHistoryPanel>────────┐  │
│ │                                 │ │ [session-history-side-panel] │  │
│ │  (the active /route's content)  │ │ ┌─[session-filter-bar]─────┐ │  │
│ │                                 │ │ │ All │Unread│Running│...   │ │  │
│ │                                 │ │ │ [session-filter-<key>]    │ │  │
│ │                                 │ │ └──────────────────────────┘ │  │
│ │                                 │ │ • [session-item-<uuid>]      │  │
│ │                                 │ │ • [session-item-<uuid>]      │  │
│ └─────────────────────────────────┘ └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

Sidebar visibility toggles via the canvas-layout state. When closed, the main pane is full-width.

## `<SessionSidebar>` — left column on every chat session (single layout)

The `w-80` left column inside the chat page (and any other view that mounts it). Despite the historical name `ToolResultsPanel` (renamed in #842), it owns the whole left chrome of an active session: role header, layout / tool-call-history toggles, the tool-result preview list, and the run-time "thinking" indicator.

```
┌─<SessionSidebar>──────────────────────────────┐
│ ┌─[sidebar-role-header]─────────────────────┐ │
│ │ ⭐ General                       🔧  ▦/▥  │ │  ← role icon + name
│ │                                            │ │     toggle right sidebar (build icon)
│ │                                            │ │     <CanvasViewToggle> single/stack
│ └────────────────────────────────────────────┘ │
│ ┌─[tool-results-scroll]────────────────────┐   │  ← scrollable list,
│ │ ┌─card (selected: ring-blue-500)──────┐ │   │     click → emit("select", uuid)
│ │ │ source •          • smart-time       │ │   │
│ │ │ [<plugin>.previewComponent]         │ │   │
│ │ └──────────────────────────────────────┘ │   │
│ │ ┌─card──────────────────────────────────┐ │   │
│ │ │ ...                                   │ │   │
│ │ └──────────────────────────────────────┘ │   │
│ └──────────────────────────────────────────┘   │
│ ┌─Thinking indicator (only while isRunning)─┐  │  ← role="status" aria-live="polite"
│ │ status • • • • [run-elapsed] (≥1s)        │  │
│ │   • pendingToolName · 2.3s                │  │
│ │   • pendingToolName · 0.8s                │  │
│ └────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

In **Stack layout** this sidebar isn't rendered; the same data flows through `<StackView>` which inlines result bodies into the main column. Only single layout shows the preview list.

## NotificationBell expanded

```
🔔[notification-bell]──┐
   🔴[notification-badge: "N"] (red dot, only when unread > 0)
   │  ┌─[notification-panel] (opens on click)──────────────────┐
   │  │ Notifications              [notification-mark-all-read]│
   │  ├─────────────────────────────────────────────────────────┤
   │  │ 🔵 Title (bold)                                       ✕ │  ← unread
   │  │ ◯  body line                                            │  data-unread="true"
   │  │ ◯  N min ago                                            │
   │  ├─────────────────────────────────────────────────────────┤
   │  │ ⚪ Title (regular)                                    ✕ │  ← read
   │  │     body line                                            │  data-unread="false"
   │  └─────────────────────────────────────────────────────────┘
   └─ each row: [notification-item-<id>]; click → router.push(target)
```

Click on a row → `useNotifications.markRead(id)` → badge decrements. The 🔵/⚪ leading dot disappears once read; bold title fades to gray.

## /chat — the chat page

```
┌─[main pane (chat)] ────────────────────────────────────────────────────┐
│ ┌─[chat column — left, single layout]──┐ ┌─[canvas column — right]──┐  │
│ │                                       │ │                          │  │
│ │  scrollback transcript (text-results, │ │ Selected tool result UI: │  │
│ │  tool-call cards, agent responses)    │ │  • <CalendarView>        │  │
│ │                                       │ │  • <MarkdownView>        │  │
│ │  • text-response (user) ──────────╮   │ │  • <SpreadsheetView>     │  │
│ │  • text-response (assistant) ─────╯   │ │  • <ChartView>           │  │
│ │  • tool-call card                     │ │  • ...                   │  │
│ │    ↳ <Preview> (compact summary)      │ │                          │  │
│ │      click → selectedResultUuid       │ │ "Edit / Apply / PDF"     │  │
│ │                                       │ │ buttons may appear at    │  │
│ │                                       │ │ the top of certain views │  │
│ │  ┌─<ChatInput> [chat-input/wrapper]─┐ │ │                          │  │
│ │  │ [user-input]                  …  │ │ │                          │  │
│ │  │ [send-btn] [stop-btn]            │ │ │                          │  │
│ │  │ [attach-file-btn]                │ │ │                          │  │
│ │  │ [expand-input-btn] (modal:       │ │ │                          │  │
│ │  │   [expanded-input]               │ │ │                          │  │
│ │  │   [expanded-send-btn])           │ │ │                          │  │
│ │  └──────────────────────────────────┘ │ │                          │  │
│ └───────────────────────────────────────┘ └──────────────────────────┘  │
│                                                                         │
│ Stack-layout collapses both columns into one (responsive / user-pref).  │
└─────────────────────────────────────────────────────────────────────────┘
```

The right canvas binds to `currentSession.selectedResultUuid`. Clicking a tool-call card on the left sets the uuid; the right pane re-renders via plugin lookup (`getPlugin(toolName).viewComponent`).

## /calendar — calendar of dated items

```
┌─[<CalendarView> mounts <SchedulerView force-tab="calendar">]──────────┐
│                                                                       │
│  ┌─Header───────────────────────────────────────────────────────────┐ │
│  │  📅 Calendar  N items     ◀ Today ▶   month ▼   week  list      │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─Grid (month/week) or List───────────────────────────────────────┐ │
│  │  Mo  Tu  We  Th  Fr  Sa  Su                                     │ │
│  │  …                                                              │ │
│  │  [scheduler-item-<id>]   "Team meeting" · 10:00                  │ │
│  │                          (drag to move; click → edit form)      │ │
│  │  ...                                                             │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  Edit form (when an item is selected):                                │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │  YAML editor: title + props.{date,time,location,notes,...}    │   │
│  │  [Apply Changes] [Cancel]                                     │   │
│  └───────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────┘
```

In chat, when the agent calls `manageCalendar`, the same `<CalendarView>` mounts inside the right canvas with `selectedResult` populated.

## /automations — scheduled tasks

```
┌─[<AutomationsView> mounts <SchedulerView force-tab="tasks">]──────────┐
│                                                                       │
│  ┌─<TasksTab>──────────────────────────────────────────────────────┐ │
│  │  ▾ Recommended frequencies (collapsed)  [scheduler-frequency-   │ │
│  │                                          hints]                 │ │
│  │                                                                 │ │
│  │  ┌─Task row [scheduler-task-<id>]──────────────────────────┐    │ │
│  │  │  user│Finance daily briefing            ▶  ⋯  ✕         │    │ │
│  │  │      every morning at 06:00 local  · next: tomorrow     │    │ │
│  │  │      [scheduler-task-run]                               │    │ │
│  │  │      [scheduler-task-delete]                            │    │ │
│  │  └─────────────────────────────────────────────────────────┘    │ │
│  │  ┌─Task row [scheduler-task-<id>]──────────────────────────┐    │ │
│  │  │  system│Wiki maintenance                ⋯               │    │ │
│  │  └─────────────────────────────────────────────────────────┘    │ │
│  │  ...                                                            │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

Origin badges: `system` (bg-gray) / `user` (bg-blue) / `skill` (bg-purple). Disabled tasks render at `opacity-50`.

## /wiki — wiki pages and lint report

Two layouts share `<WikiView>`: the **index** (page list) and a **single page** body.

### Index

```
┌─[<WikiView> action="index"]────────────────────────────────────┐
│ Tags filter: [wiki-tag-filter-all] [wiki-tag-filter-<tag>] ... │
│                                                                │
│ ┌─Entry list─────────────────────────────────────────────────┐ │
│ │ • [wiki-page-entry-<slug>]                                 │ │
│ │   Title  — short description  #tag #tag                    │ │
│ │   click → /wiki/pages/<slug>                               │ │
│ │ • [wiki-page-entry-<slug>]                                 │ │
│ │   ...                                                      │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
│ [wiki-create-page-button]   [wiki-update-page-button]          │
│ [wiki-lint-chat-button] (asks the agent to run lint_report)    │
└────────────────────────────────────────────────────────────────┘
```

### Single page

```
┌─[<WikiView> action="page" pageName="<slug>"]──────────────────┐
│ ▮ <slug>                            [wiki-update-page-button] │
│ ┌─Markdown content (.wiki-content, scrollable)──────────────┐ │
│ │ # Title                                                   │ │
│ │ markdown body...                                          │ │
│ │ ![image](relative/path)  ← rewritten to /api/files/raw    │ │
│ │ [[wiki-link]]            ← rewritten to /wiki/pages/<slug>│ │
│ └───────────────────────────────────────────────────────────┘ │
│ Per-page chat composer:                                       │
│   [wiki-page-chat-input]  [wiki-page-chat-send]               │
└───────────────────────────────────────────────────────────────┘
```

## /sources — registered news/RSS feeds

```
┌─[<SourcesManager>]─────────────────────────────────────────────────┐
│ Top bar: [sources-add-btn] [sources-rebuild-btn]                   │
│                                                                    │
│ Add form (when adding) [sources-add-form]:                         │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ kind ▼  [sources-draft-kind]                                   │ │
│ │ url    [sources-draft-primary]                                 │ │
│ │ title  [sources-draft-title]                                   │ │
│ │ [sources-draft-cancel]   [sources-draft-add]                   │ │
│ │ error  [sources-draft-error]                                   │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ Filter chips: [sources-filter-chip-<key>] [sources-filter-clear]   │
│                                                                    │
│ ┌─Source row [source-row-<slug>]─────────────────────────────────┐ │
│ │  RSS │ Federal Reserve  · federal-reserve                      │ │
│ │       https://www.federalreserve.gov/feeds/press_all.xml       │ │
│ │       #central-bank                              [source-      │ │
│ │                                                  remove-<slug>]│ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ...                                                                │
│                                                                    │
│ Empty state: [sources-empty] (if no feeds yet) → preset buttons    │
│   [sources-preset-<id>]                                            │
│                                                                    │
│ Last rebuild summary at the bottom: [sources-rebuild-summary]      │
└────────────────────────────────────────────────────────────────────┘
```

## /todos — Kanban / table / list of tasks

```
┌─[<TodoExplorer>]───────────────────────────────────────────────────┐
│ Top bar:                                                           │
│  [todo-search]   [todo-add-btn]   [todo-column-add-btn]            │
│  view mode: [todo-view-kanban] [todo-view-table] [todo-view-list]  │
│                                                                    │
│ Kanban (default):                                                  │
│ ┌─Backlog─────┐ ┌─Todo──────┐ ┌─In Progress─┐ ┌─Done────────┐      │
│ │             │ │           │ │             │ │             │      │
│ │ [todo-card- │ │           │ │             │ │             │      │
│ │  <id>]      │ │           │ │             │ │             │      │
│ │   Title     │ │           │ │             │ │             │      │
│ │   #label    │ │           │ │             │ │             │      │
│ │             │ │           │ │             │ │             │      │
│ └─────────────┘ └───────────┘ └─────────────┘ └─────────────┘      │
│                                                                    │
│ Drag cards across columns to change state.                         │
└────────────────────────────────────────────────────────────────────┘
```

## /files — workspace file explorer

```
┌─[<FilesView>]──────────────────────────────────────────────────────────┐
│ ┌─Tree pane──────────┐ ┌─Preview pane (route param: pathMatch)───────┐ │
│ │ ▶ artifacts/       │ │                                             │ │
│ │ ▼ config/          │ │  Selected file: data/sources/foo.md         │ │
│ │   • interests.json │ │                                             │ │
│ │   • mcp.json       │ │  ┌─Preview rendered by FileContentRenderer┐ │ │
│ │   • settings.json  │ │  │                                        │ │ │
│ │ ▶ conversations/   │ │  │  • markdown → marked + Vue             │ │ │
│ │ ▶ data/            │ │  │  • images → <img>                      │ │ │
│ │ ▼ data/sources/    │ │  │  • todos JSON → <TodoExplorer>         │ │ │
│ │   • foo.md   ←sel  │ │  │  • scheduler items.json → <CalendarView>│ │ │
│ │   • bar.md         │ │  │  • code → text                         │ │ │
│ │ ...                │ │  │                                        │ │ │
│ └────────────────────┘ │  └────────────────────────────────────────┘ │ │
│                        └─────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

The preview pane reuses plugin views — clicking a `config/scheduler/items.json` mounts `<CalendarView>` via `toSchedulerResult` (issue #832 / #833 will add a description banner + Edit button on top of this).

## /skills — workspace skills list

```
┌─[<SkillsManager>]──────────────────────────────────────────────────┐
│ Add skill form (modal)                                             │
│                                                                    │
│ ┌─Skill row──────────────────────────────────────────────────────┐ │
│ │  📜 daily-briefing-finance                                     │ │
│ │      "Fetch top 3 articles, cluster, write briefing"           │ │
│ │                                              ⏵ run  ✏ edit  ✕ │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ...                                                                │
└────────────────────────────────────────────────────────────────────┘
```

## /roles — role configuration

```
┌─[<RolesManager>]───────────────────────────────────────────────────┐
│ ┌─Built-in roles (read-only)─────────────────────────────────────┐ │
│ │ ⭐ General              "Helpful assistant w/ workspace access" │ │
│ │ 🎨 Artist                ...                                   │ │
│ │ 🎓 Tutor                 ...                                   │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌─Custom roles────────────────────────────────────────────────── ┐ │
│ │  + add role                                                    │ │
│ │  📖 my-role     ✏ edit   ✕                                     │ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

## How to use this doc in chat

When asking Claude (or a teammate) to change the UI, name what you mean:

> ❌ "Make the bell smaller"
> ✅ "Reduce the badge size on `[notification-badge]` — it's overflowing the bell button on narrow screens"

> ❌ "The schedule page is broken"
> ✅ "On `/automations`, `[scheduler-task-<id>]` rows render at full opacity even when `task.enabled === false` — the `opacity-50` class isn't applying"

> ❌ "Add a button to the wiki page header"
> ✅ "Next to `[wiki-update-page-button]` in `<WikiView>` action='page', add a `[wiki-export-pdf-button]` that calls `usePdfDownload`"

If a name in this doc no longer matches the source (renamed testid, restructured layout), **update the doc in the same PR as the rename** — same discipline as updating tests when changing API.

## Out of scope

- **Pixel-accurate layout** — use Playwright screenshots or a Figma file.
- **Hover / focus / animation states** — describe in code comments next to the styles.
- **Mobile / narrow-screen breakpoints** — captured in `tailwind.config.ts` + the responsive class soup; not redrawn here.
- **Modal / popover stacking order** — surface in the relevant component's `<!-- -->` doc comment, not here.
- **Plugin-internal sub-views** that don't have their own route — TodoEditDialog, MindMap, Quiz, Form, etc. Add stubs as the cheat sheet matures.
