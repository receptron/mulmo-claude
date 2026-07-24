# refactor: unify the duplicated `SessionSummary` declaration

Issue: #2334

## Context

`jscpd` flagged 75 tokens / 42 lines duplicated between
`server/api/routes/sessions.ts` (71-110) and `src/types/session.ts` (59-85):
the same `interface SessionSummary` written out twice, once per side of the
`GET /api/sessions` boundary.

Unlike the other dedup issues in this batch, the payoff here is not line
count — it is that **TypeScript cannot police an API boundary described by two
independent types**. Add a field server-side and forget the client copy: no
error, the field is just permanently `undefined` at runtime. Add it
client-side only: same silence, opposite direction.

## Pre-check: are they actually identical today?

Yes. Stripping comments from both declarations gives a byte-identical field
list — same 14 fields, same order, same types, same optionality:

```
id, roleId, startedAt, updatedAt, preview, summary?, keywords?, origin?,
isBookmarked?, userQueryCount?, isRunning?, liveIsRunning?, hasUnread?,
statusMessage?
```

No live drift to report. Only the comment prose differs.

## Change

- `src/types/session.ts` keeps the declaration and becomes the single source
  of truth. Comment blocks from both sides are merged into it (the `#123`
  chat-indexer origin of `summary`/`keywords`, the `#486` origin field, the
  `#1195` broad-`isRunning` vs narrow-`liveIsRunning` split and why the narrow
  one must stay byte-identical to the DELETE 409 gate).
- `server/api/routes/sessions.ts` drops its copy and widens its existing
  `../../../src/types/session.js` import to pull in `type SessionSummary`.
  The route already imports `SESSION_ORIGINS` / `SessionOrigin` from that same
  path and `API_ROUTES` from `../../../src/config/apiRoutes.js`, so no new
  dependency direction is introduced.
- The server's `export` on the interface is dropped, not converted to a
  re-export: nothing imported `SessionSummary` from the route module, and
  CLAUDE.md forbids unjustified re-exports.

## Deliberately NOT touched

- `packages/chat-service/src/types.ts` also declares a `SessionSummary`, but
  it is a genuinely different, narrower shape (`id`, `roleId`, `preview`,
  `updatedAt`) belonging to the bridge chat-service contract. Not a duplicate.
- `test/routes/test_sessionsRoute.ts` declares a local 5-field
  `SessionSummary` for its response assertions. Deliberately narrow — the test
  asserts on the subset it cares about and should not be coupled to every
  optional field the route may add.

## Verification

Type-only change, so the type checkers are the test:

- `yarn typecheck` (vue + server + test + e2e + e2e-live + packages) and
  `npx vite build`.
- `test/routes/test_sessionsRoute.ts`, `test/utils/session/*`,
  `test/composables/test_useSessionHistoryHelpers.ts`.
- Boundary proof: temporarily add a field to the shared `SessionSummary` and
  confirm `typecheck:server` now sees it from `server/api/routes/sessions.ts`
  (it did — the excess-property check fired inside `buildSessionSummary`),
  then remove it. Before this change the same experiment would have been
  invisible to the server.
