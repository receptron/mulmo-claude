# fix(#2310): googleCalendar sync writes datetimes the collection validator rejects

Issue: #2310 — every record written by the `googleCalendar` block is reported as a data
problem ("23件のレコードファイルにデータの問題があり…"). The data is intact; the stored
values are simply not in the shape a `datetime` field is validated against.

## Root cause (verified, not assumed)

Three layers, all doing exactly what they were written to do:

| Layer | File | Behaviour |
|---|---|---|
| REST projection | `packages/core/src/google/calendar.ts` → `eventTime()` | returns Google's raw value: `value.dateTime` (`2026-05-12T08:45:00+09:00`, sometimes `…Z`) or `value.date` (`2026-03-18`) |
| Record projection | `packages/core/src/google/collectionSync.ts` → `toCollectionRecord()` | copies it into the record with no normalisation |
| Record lint | `packages/core/src/collection/core/recordZ.ts` → `strictTypeProblem()` | validates `datetime` with `parseIsoDateTime` (`collection/core/calendarGrid.ts`) |

`parseIsoDateTime` requires `YYYY-MM-DDTHH:MM[:SS]`. Reproduced against the built package:

```
"2026-05-12T08:45:00+09:00" -> null     # split(":") yields 4 parts
"2026-05-12T08:45:00Z"      -> null     # "00Z" is not two digits
"2026-03-18"                -> null     # no "T"
"2026-05-12T08:45:00-05:00" -> null
"2026-05-12T08:45:00"       -> ok
"2026-05-12T08:45"          -> ok
```

## Decision: fix the sync path, not the validator

The validator's strict shape is deliberate — its own comment says a `Z` suffix is
something the day view cannot place. Loosening it would turn a visible lint error into an
invisible "event missing from the calendar" bug. So the sync normalises on write.

- **Timed events** — drop the zone designator, keep the wall clock:
  `2026-05-12T08:45:00+09:00` → `2026-05-12T08:45:00`. This is the time the user sees in
  Google Calendar, and it does not depend on the host's clock/TZ. A trailing `Z` is
  handled the same way. **No conversion to local time.**
- **All-day events** — `2026-03-18` → `2026-03-18T00:00`.
- **Target-type driven** — normalise only when the *mapped collection field* is declared
  `datetime`. A user who maps `start` onto a `string` field asked for Google's raw value
  and keeps it.

## Changes

- **new** `packages/core/src/google/collectionDateTime.ts` — `toCollectionDateTime(value)`,
  a pure function in its own file (no I/O, no clock), so the rule is unit-testable.
- `packages/core/src/google/collectionSync.ts` — `toCollectionRecord()` takes the schema's
  `fields` as a 4th parameter and routes each mapped value through the normaliser only
  when that field's spec type is `datetime`. Field lookup is own-property (`Object.hasOwn`),
  matching the hardening in #2320/#2322.
- `packages/core/src/google/index.ts` — export the normaliser.
- `docs/shared-utils.md` — catalog entry (CLAUDE.md requires it in the same PR).

## Tests

`test/services/google/test_calendarDateTime.ts` (new) — `+09:00`, a negative offset, `Z`,
no offset at all, date-only, seconds present/absent, fractional seconds, empty string,
non-string, whitespace, and unparseable junk. Every normalised output is asserted against
the real `parseIsoDateTime` (imported, not a guessed regex) so the test pins the actual
contract rather than a restatement of the implementation.

`test/services/google/test_calendarCollectionSync.ts` — extended: a `datetime` target is
normalised, a `string` target is passed through byte-for-byte, an undeclared field falls
back to raw, and the all-day → `T00:00` case replaces the old "carries date values through
unchanged" expectation.

Verification: reverting `toCollectionDateTime` to `(value) => value` must turn the new
tests RED (recorded in the PR).

## Migration — existing broken records do NOT self-heal

The sync upserts by event id and only fetches what changed since the stored sync token
(`packages/core/src/google/calendarSyncStore.ts`). Google never resends an unchanged
event, so the ~23 records already on disk keep their rejected values until each event is
edited in Google.

Remedy (manual, one line): delete `<workspace>/data/calendar/.sync-state.json` (or the one
`tokens` entry for that calendar) and let the next scheduled run do a full walk — writes
are keyed by event id, so every existing record is rewritten in place, not duplicated.
`clearCalendarSyncToken(calendarId, workspaceRoot)` is the programmatic equivalent; it is
currently called only on Google's 410 (expired token).

An automatic remedy (e.g. a one-shot token clear on upgrade) is **proposed in the PR, not
implemented here** — a forced full walk over a calendar with years of history is a real
cost and should be an explicit choice.

## Out of scope

- A timed event mapped onto a `date` (not `datetime`) field still stores the raw value and
  still lints. Deliberate: the decision is to key off the declared target type, and no
  recipe maps `start` onto `date`.
- Loosening `parseIsoDateTime` — see above.
- `@mulmoclaude/core` version bump: this PR touches `src` only (no `assets/helps/*`
  change), and the repo's convention is that `src` fixes ride the next `chore(release)`.
