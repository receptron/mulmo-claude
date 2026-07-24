# docs(2312): route the schema author to the `googleCalendar` block

Issue: #2312 — "schemaDocs has no mention of googleCalendar — agent cannot discover the feature"

## Problem

Asked to "create a collection that syncs with Google Calendar", the agent builds
the collection the old way: a Google MCP connector plus an `ingest: { kind: "agent" }`
worker that re-fetches events with an LLM turn on every refresh. The zero-token
`googleCalendar` schema block — the host-side sync that exists precisely for this —
is never used.

Verified cause: `packages/core/assets/helps/collection-skills.md` (1175 lines) is the
schema DSL reference the agent reads while authoring a schema, and it contains **zero**
occurrences of `googleCalendar` or "Google Calendar". The feature is documented in
`packages/core/assets/helps/google-calendar-collection.md` and indexed in `helps/index.md`,
but nothing routes the agent there at the moment the question arises:

- `error-recovery.md` is read on tool failure — the MCP path *succeeds*, so it never fires.
- No keyword routing surfaces `google-calendar-collection.md`.

The reporter's two prompts differ only by "helps/ の md を参照してください"; with that
sentence the agent finds the block, without it the agent never does.

## Delivery constraint that decides the placement

`manageCollection: { action: "schemaDocs" }` does **not** return the whole file.
`packages/core/src/collection/server/schemaDocs.ts` sections it:

- no `topic` → the doc intro + the **own prose** of the core sections
  (`CORE_SECTION_PATTERNS = ["anatomy", "skill.md", "the dsl", "field types", "end-to-end", "editing an existing"]`)
  + a table of contents listing **every** heading;
- `topic: "<heading>"` → that section's subtree;
- `topic: "all"` → the full dump.

The own prose of `## schema.json — the DSL` is the **top-level shape table**, and it is
served on every no-topic call. An `###` subsection under it is *not* served by default —
it only reaches the agent through the TOC or an explicit `topic`.

So a mention buried in a new `###` section alone would still be invisible on the default
call. The fix must land in the table.

## Change (option A from the issue)

`packages/core/assets/helps/collection-skills.md`:

1. **A `googleCalendar` row in the top-level shape table** (`## schema.json — the DSL`).
   This is the sentence the agent meets on the default `schemaDocs` call, in the same
   place it is already reading `dataPath` / `spawn` / `views`. It states the LLM-free
   selling point, says explicitly to prefer it over an `ingest: { kind: "agent" }` worker
   or the `google` MCP tools, and points at `config/helps/google-calendar-collection.md`.

2. **A short `### Google Calendar sync (`googleCalendar`)` section**, placed immediately
   after `### Scheduled agent refresh (ingest.kind: "agent")` — its sibling opt-in block,
   and the section an agent lands in when it asks "how does a collection refresh itself on
   a schedule". Adds the TOC entry `Google Calendar sync (googleCalendar)` and makes
   `topic: "google calendar"` resolve. Format follows the neighbouring `### Custom views`
   entry: the block, why to reach for it, the one trap that is not guessable
   (never map the `primaryKey`), then a pointer.

Deliberately **not** duplicating `google-calendar-collection.md` — deletion semantics, the
`calendarId` lookup, and the first-run full-walk caveat stay in the one file that owns them.

Assertions checked against the implementation, not memory:

- `packages/core/src/collection/core/schemaZ.ts` — `GoogleCalendarSyncZ` = `{ calendarId?: string, map: Record<string, GOOGLE_CALENDAR_SOURCE_FIELDS> }`,
  `map` non-empty (refine), `GOOGLE_CALENDAR_SOURCE_FIELDS = ["summary","start","end","htmlLink","colorId","status"]`.
- `googleCalendarMapNamesStoredFields` (`schemaRules.ts`) — a map key must name a declared,
  non-computed field and never the `primaryKey`.
- `dataSource` collections cannot declare `googleCalendar` (read-only refine, schemaZ.ts:798).

## Not changed, and why

- `helps/index.md` — its `collection-skills.md` summary describes the DSL, and a dedicated
  `Google Calendar sync` entry already exists two lines above. The routing gap was *inside*
  `collection-skills.md`; the index was never the failure point.
- `docs/` — developer docs, not agent-facing; nothing there discusses the schema DSL surface.
- No source change. Option B (keyword routing over the helps index) is a real feature and
  stays out of a docs fix.

## Test

`test/agent/test_manageCollection.ts` (`manageCollection — schemaDocs`) is where the real
bundled doc is exercised. Add:

- the **default** reply (no topic) names `googleCalendar` and points at
  `config/helps/google-calendar-collection.md` — this is the regression test for the exact
  reported failure;
- `topic: "google calendar"` resolves to the new section.

Mutation check: revert the doc edit, watch both go red, restore.

## Release

`assets/helps/*` ships to npm with `@mulmoclaude/core` (`files: ["dist", "assets"]`), so an
unpublished help edit is invisible to installed users. Bump `@mulmoclaude/core` 1.0.1 → 1.0.2
and sweep every consumer range to `^1.0.2` (`packages/mulmoclaude`, `collection-plugin` deps +
peerDeps, `google-plugin`) to keep the launcher-sync invariant green. Same shape as c97d9a82.
The launcher's own `version` is untouched.
