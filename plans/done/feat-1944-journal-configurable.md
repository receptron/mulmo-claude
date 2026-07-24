# feat(#1944 follow-up): journal daily pass configurable + origin filter

## Summary

Follow-up to #1949 (chat-index configurable). Same three-state opt-out
mechanism for the journal daily pass:

- **`AppSettings.journal`** — `"off"` (default) / `"haiku"` / `"sonnet"`.
  `"off"` short-circuits `maybeRunJournal` before it takes the in-process
  lock or reads the pass state file. `"haiku"` / `"sonnet"` pick the
  model the archivist CLI spawns.
- **Origin filter** (always on, mirrors chat-index): sessions whose
  `meta.origin` is `system` or `scheduler` are excluded from
  `loadDirtySessionExcerpts` regardless of the mode. They surface no
  user-authored content worth summarising into a personal journal.
- **`--model` flag** now passed to `claude` when the model is known,
  threaded via a widened `Summarize` type. The CLI-only call path is
  preserved for direct callers that don't specify a model.

## Items to Confirm / Review

- **Default `off`.** Existing users with the journal running silently
  will notice titles + memory stop generating until they opt in. The
  user asked for the same UX pattern as chat-index; this matches.
- **Origin filter caveat.** The filter reads meta per dirty session on
  each pass. Journal already reads meta downstream (`readRoleIdFromMeta`),
  so the extra read is one more per dirty session — negligible next to
  the archivist CLI cost.
- **`--model` threading via a pre-bound closure.** `runJournalPass`
  wraps the raw `summarize` in `(sys, user) => rawSummarize(sys, user,
  { model })` so downstream layers (`dailyPass`, `optimizationPass`,
  `memoryExtractor`) don't need signature changes.
- **`JournalSummaryModel` union** deliberately excludes `"off"` so a bad
  string can't reach `--model` — the entry-point (`maybeRunJournal`)
  filters that state out before we get here.
- **i18n**: 8 locales in lockstep (en / ja / de / es / fr / ko / pt-BR / zh).

## User Prompt

> どうように、Journal dailly pass もoptoutできるように設定を追加したい。
> B (3-state matching chatIndex, with default off)
> Journal dailly pass もsystem / scheduler のチャットを除外するのがよい？

## Implementation

### Server

- `server/system/config.ts` — `JOURNAL_MODES` + `JournalMode` type +
  `AppSettings.journal?` field + `isJournalMode` validator +
  `isOptionalNullableJournalMode` mini-helper (complexity-relief) +
  `AppSettingsPatch.journal?: JournalMode | null` + patch normaliser
  drops null sentinel + `cloneAppSettings` copies the field +
  `saveSettings` persists it + `journalMode(settings)` resolver.

- `server/api/routes/config.ts` — new `body.journal === null → delete
  merged.journal` branch mirrors the chatIndex one.

- `server/workspace/journal/archivist-cli.ts` — `JournalSummaryModel =
  "haiku" | "sonnet"` type; `Summarize` type widened to accept an
  optional `{ model?: JournalSummaryModel }` third arg; `runClaudeCli`
  appends `--model <model>` to the CLI args when a model is supplied.

- `server/workspace/journal/index.ts` — `MaybeRunJournalOptions.mode`
  injectable, defaults to `journalMode(loadSettings())`. `mode === "off"`
  short-circuits before locking. `runJournalPass` receives the resolved
  model and pre-binds it onto the summarize callable, so no downstream
  signatures change.

- `server/workspace/journal/dailyPass.ts` —
  `isEligibleForJournalByOrigin` filter drops `system` / `scheduler`
  sessions inside `loadDirtySessionExcerpts` before the excerpt read.
  `NON_INDEXED_ORIGINS` set mirrors the chat-index one exactly (no
  shared import to keep the modules loosely coupled).

### Client

- `src/components/SettingsJournalTab.vue` — new tab, mirrors
  `SettingsChatIndexTab.vue` (3-state select, auto-save, null sentinel
  on "off").
- `src/components/SettingsModal.vue` — new `journal` `TabId` in the LLM
  group after `chatIndex`; reload token bumped on modal open; tab
  rendered via `<SettingsJournalTab>`.
- 8 locales — `journal` tab label + full `journalTab` block.

### Tests

- `test/server/test_config.ts` — 4 new blocks: `isAppSettingsPatch`
  accepts every JOURNAL_MODES value + null / rejects unknown;
  `normaliseAppSettingsPatch` strips null / preserves value;
  `saveSettings` persists and roundtrips; `saveSettings` omits the
  field when unset; new `journalMode` resolver suite.
- `test/routes/test_configRoute.ts` — 3 new tests for PUT
  `/api/config/settings`: sets from patch and roundtrips through
  `loadSettings`; clears when the patch sends null; rejects unknown
  values with 400.
- `test/journal/test_maybeRunJournal.ts` — 4 existing calls pinned
  `mode: "haiku"` (previously ambient-settings dependent). New
  `mode kill switch` describe block: `mode: "off" + force: true` must
  short-circuit before summarize; `mode: "sonnet"` threads the model
  through to every summarize call.

## Test plan

- [x] `yarn tsx --test test/server/test_config.ts test/routes/test_configRoute.ts test/journal/test_maybeRunJournal.ts` — 86 pass.
- [x] `yarn tsx --test test/chat-index/*.ts test/journal/*.ts` — 337 pass (no regressions in either subsystem).
- [x] `yarn format` / `yarn lint` (0 errors, 26 pre-existing warnings) / `yarn typecheck` / `yarn build`.
- Manual: Settings → Journal, flip through off / haiku / sonnet.
  Confirm auto-save banner turns green and `settings.json` gains /
  drops the field. With `journal: "haiku"`, trigger a chat turn that
  crosses the daily interval; confirm the log line shows the
  archivist CLI was invoked and its `--model` flag was `haiku`. Repeat
  for `sonnet`. Flip to `off`; confirm the hourly scheduler is
  effectively silent.

## Out of scope

- Migrating existing users' journal pass state on first launch —
  they'll notice "no new journal entries" until they opt in. Same
  behaviour as chat-index; if this is a support pain point we can add
  a one-shot banner in a follow-up.
- Extending the same 3-state / off-default pattern to other
  summarizer entry points (memory extraction re-uses `summarize`, so
  its model already follows the journal mode via the closure).
