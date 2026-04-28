# `systemFiles.*` i18n namespace fill-in (#880)

`SystemFileBanner.vue` references `systemFiles.<id>.title`, `systemFiles.<id>.summary`, `systemFiles.editPolicy.<policy>`, `systemFiles.schemaLabel`, `systemFiles.showDetails`, and `systemFiles.hideDetails`, but the namespace is **completely missing** from all 8 locale files. Banners on every system file (journal daily, roles, mcp.json, wiki schema, etc.) currently render raw key strings.

## Keys to add (en.ts source of truth)

### Per descriptor (21 ids × 2 keys)

For each descriptor id from `src/config/systemFileDescriptors.ts`:
- `title` — short, banner-headline form (e.g. `"Daily journal summary"`)
- `summary` — 1–2 sentence explanation: what the file is, who edits it, why it matters

| id | title | summary (gist) |
|---|---|---|
| interests | Interests config | What topics the news/source pipelines watch |
| mcp | MCP servers | External tool servers attached to the agent |
| settings | App settings | User-editable behavioral preferences |
| schedulerTasks | Scheduler tasks | Recurring agent automations |
| schedulerOverrides | Scheduler overrides | Per-task time / interval overrides |
| newsReadState | News read state | Ephemeral local read tracking |
| schedulerItems | Scheduler items | Active scheduled invocations queue |
| todosItems | Todo items | Your tasks across columns |
| todosColumns | Todo columns | Column layout (user-defined order) |
| wikiIndex | Wiki index | Generated index of all wiki pages |
| wikiLog | Wiki log | Activity log of wiki edits |
| wikiSummary | Wiki summary | Generated wiki overview |
| wikiSchema | Wiki schema | Format spec — fragile, do not freeform-edit |
| memory | Memory | Distilled facts about you, loaded as context |
| summariesIndex | Summaries index | Browseable index of journal summaries |
| rolesJson | Role definition (JSON) | Role config — model, MCP servers, plugins |
| rolesMd | Role description (Markdown) | Role's persona / system-prompt prose |
| sourceFeed | Source feed | One subscribed source (RSS / GitHub / etc.) |
| sourceState | Source state | Ephemeral pipeline state for one source |
| journalDaily | Daily journal summary | Auto-generated daily recap of your activity |
| journalTopic | Topic journal | Long-running notes for a specific topic |

### Edit-policy chip labels (5)

| policy | English label |
|---|---|
| agent-managed-but-hand-editable | Agent-managed (hand-edit OK) |
| user-editable | User-editable |
| agent-managed | Agent-managed |
| fragile-format | Fragile format |
| ephemeral | Ephemeral |

### Framework (3)

- `schemaLabel` — `"Schema"` (rendered as "Schema:")
- `showDetails` — `"Show details"`
- `hideDetails` — `"Hide details"`

Total: 21×2 + 5 + 3 = **50 keys per locale × 8 locales = ~400 entries**.

## Translation rules

- Each locale gets a real translation, not English copy. Confirm with native conventions.
- Keep titles short (chip-friendly) and summaries to ≤2 sentences.
- Edit policies are chips — keep them terse (1–3 words).
- German file: avoid German typographic quotes (U+201E / U+201C) in
  string literals — the tokenizer can collapse U+201C to ASCII `"`,
  silently terminating the surrounding JS string. Use ASCII quotes
  inside the source; if user-facing typographic quotes are needed,
  inject them via Unicode escapes from a Node one-liner instead of
  the Edit / Write tools.
- vue-tsc enforces lockstep — missing keys in any locale = build fail.

## Validation

- `yarn typecheck` — fails if any locale missing a key
- `yarn build` — same (vue-tsc gate)
- Manual: open one journal daily file, one role file → banner renders translated copy in current locale (no `systemFiles.` substring visible)

## Files

8 modified:
- `src/lang/en.ts` (source of truth — write first)
- `src/lang/ja.ts`
- `src/lang/zh.ts`
- `src/lang/ko.ts`
- `src/lang/es.ts`
- `src/lang/pt-BR.ts`
- `src/lang/fr.ts`
- `src/lang/de.ts`
