# Comment reduction sweep (#910)

## Goal

Bring the codebase in line with the existing `CLAUDE.md` policy:

> Default to writing no comments. Only add one when the WHY is non-obvious. Don't explain WHAT the code does, since well-named identifiers already do that.

The codebase has accreted **WHAT comments** over time — section banners, function-name restatements, and explanatory prose that PRs / AI scaffolds added. They have to be re-read forever and silently rot when the code beneath drifts. Names + types should carry the load.

## What gets deleted (per file pass)

- Section banners restating the next line (`// Initialize form data` → delete).
- Comments naming what a function already says in its name (`// Update the user` above `function updateUser(…)`).
- "What this code does" prose paragraphs that summarise the body.
- Magic-number explanations → extract a `const NAME_OF_THING_MS = …` constant, comment-free.
- Stale `TODO` / `FIXME` whose underlying concern landed.
- Re-export breadcrumbs (`// helper function`, `// public api`).

## What stays

- WHY comments anchored to non-obvious context: past bugs, race conditions, browser / library quirks, security gotchas, IANA validation rules, vue-i18n compiler edges, etc.
- Algorithm-level commentary inside dense functions (cognitive complexity ≥ 12 is a rough threshold).
- File-header docblocks that tell a fresh reader what this module is for.
- License / attribution / copyright notices.

## Method

**One module per PR.** Don't spread the diff. Per pass:

1. Pick a directory (see ordered list below).
2. Read every comment. Tag each as WHAT (delete), WHY (keep), or RENAMABLE (refactor identifier, then delete).
3. For each RENAMABLE: minimal rename / type tightening / function extraction so the WHAT becomes redundant.
4. Run `yarn lint && yarn typecheck && yarn build && yarn test`. **No behavior change.**
5. PR title `refactor: drop WHAT comments in <module>`. Description includes a Before/After of one representative comment-block deletion so reviewers can judge the trade.

## Ordered targets

Highest signal-to-noise first — places where I (Claude) recently piled on commentary, or where the code has stabilised since the explanatory PR landed.

1. **`src/plugins/presentForm/`** (#826 fork + #845 lint-compliance pass) — both passes added running commentary. Single small module, good warm-up.
2. **`server/agent/mcp-tools/`** (notify, x, askUserChoice) — short tool files each carrying a multi-paragraph header that mostly restates the tool definition's `description` string.
3. **`server/workspace/journal/`** (#799 PR1–PR4 audit roadmap) — explanatory comments from the audit phase persist even though the code is now stable.
4. **`src/components/SessionSidebar.vue`** (renamed from `ToolResultsPanel.vue`) — rename made some "this used to be …" comments stale.
5. **`src/composables/`** — composables tend to have header docblocks that restate the function name.
6. **`server/utils/files/*-io.ts`** — domain-IO modules each open with a paragraph explaining the seam, which the file path + types now carry.
7. **`src/plugins/scheduler/`** (#824 split into manageCalendar + manageAutomations) — split-time explanatory comments.
8. **`server/agent/index.ts`** — agent loop has historical commentary that the surrounding refactors (LLMBackend interface in #834) made redundant in places.

(Order is heuristic — re-prioritise as we sweep and learn what's costly vs. cheap.)

## Acceptance criteria per PR

- Net comment line count goes **down** for the touched files (or stays flat if the win was in a rename trade rather than raw deletion).
- **No** logic edits — only comments removed, identifiers renamed, types refined, or constants extracted.
- All four checks green: lint / typecheck / build / test.
- Reviewer can pick one deleted comment and confirm "yes, the code now says the same thing without the comment".

## Out of scope

- Style edits unrelated to comments (brace style, import order, etc.).
- Documentation under `docs/**` — those are intentionally explanatory.
- Localized text in `src/lang/**` — translations are content, not commentary.
- Bulk codemods that delete every `// ` line — false positives on WHY comments would erase real context.

## Tracking

| # | Module | PR | Notes |
|---|---|---|---|
| 1 | `src/plugins/presentForm/` | _(pending)_ | Pilot — establishes the Before/After format |
| 2 | `server/agent/mcp-tools/` | | |
| 3 | `server/workspace/journal/` | | |
| 4 | `src/components/SessionSidebar.vue` | | |
| 5 | `src/composables/` | | |
| 6 | `server/utils/files/` | | |
| 7 | `src/plugins/scheduler/` | | |
| 8 | `server/agent/index.ts` | | |

When a target PR merges, fill its row in. When the table is fully green, this plan moves to `plans/done/`.

## Related

- Issue: #910
- Project rule: `CLAUDE.md` — "Default to writing no comments…"
- Global rule: `~/.claude/CLAUDE.md` § Coding Style → Comments (added in the same conversation that opened #910).
