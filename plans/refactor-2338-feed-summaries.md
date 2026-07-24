# refactor: dedup feed-summary building between the REST route and the remote-host handler

Issue: #2338

## Context

`jscpd` flagged 66 tokens / 11 lines duplicated between the two entry points
that serve the SAME feeds index:

| File                                      | Range                                  |
| ----------------------------------------- | -------------------------------------- |
| `server/api/routes/feeds.ts`              | 34-46 (desktop `GET /api/feeds`)       |
| `server/remoteHost/handlers/listFeeds.ts` | 21-33 (phone, remote-host `listFeeds`) |

Both build `{ slug, title, icon, kind, schedule, lastFetchedAt }` per feed, and
both carry their own copy of the `kind ?? "rss"` / `schedule ?? "on-demand"`
defaults. A field added on one side is invisible on the other — a
platform-divergence bug that only reproduces on one device.

The two loops were compared field by field: **byte-for-byte identical** apart
from how `readFeedState` / the workspace root reach them (route imports them,
handler injects them). No behavioural difference to reconcile.

## What this does

- New `server/workspace/feeds/summaries.ts` — the host's feeds domain module
  (sibling of the existing `configure.ts`), exporting
  `buildFeedSummaries(feeds, readFeedState, workspaceRoot)`.
  - `readFeedState` and `workspaceRoot` are **parameters**, matching the DI the
    remote-host handler already uses, so the projection is testable with a stub
    reader and never touches the filesystem.
  - The two defaults become named constants typed against the shared ingest
    vocabulary (`IngestKind` / `FeedSchedule`), so a typo can't slip in.
  - Input is a minimal structural type (`FeedSummarySource`) that
    `LoadedCollection` satisfies — tests can build stub feeds without a cast.
- Both call sites now call it.
- `server/api/routes/feeds.ts` drops its LOCAL `FeedSummary` /
  `FeedsListResponse` interface copies and imports the canonical ones from
  `@mulmoclaude/core/collection` — the same types the client's `FeedsView.vue`
  already renders against. That is a second copy of the same shape, removed in
  the same pass.

### Why the host, not `@mulmoclaude/core`

Both callers are host code and nothing under `packages/` needs the projection.
The response TYPE already lives in core (`collection/core/uiTypes.ts`) and is
now imported from there, so the contract stays single-sourced; only the host's
assembly of it is shared host-side. Placing it in core would push a host-only
concern down a tier for no consumer.

## Deliberately NOT done

- `return { feeds: summaries } as unknown as JsonObject;` in `listFeeds.ts`
  stays. It is a repo-wide idiom across 8 remote-host handlers: `CommandHandler`
  returns `JsonValue`, and an `interface` (no implicit index signature) is not
  assignable to `Record<string, JsonValue>`. Removing it properly means turning
  core's `FeedSummary` interface into a type alias (or adding a shared
  `toJsonObject` seam) and sweeping all 8 handlers — a separate change. No new
  cast was introduced.

## Verification

- `test/workspace/feeds/test_feedSummaries.ts` (node:test, stub `readFeedState`,
  no filesystem): no `ingest` (both defaults), `ingest.kind` only,
  `ingest.schedule` only, missing `lastFetchedAt`, zero feeds, multiple feeds
  keep registry order, reader receives the injected root + the feed itself.
- Mutation-checked: flipping `DEFAULT_KIND` to `"atom"` turns the default-value
  tests RED; restored after.
- `yarn format`, `eslint` on the changed paths, `yarn typecheck`.
