// Host-driven recurrence for schema-driven collections.
//
// When a record satisfies its schema's `spawn.when` predicate (default:
// the item is "done" per completionField/completionDoneValues), the host
// creates the NEXT record with a forward-advanced `triggerField` date.
//
// The mechanism is CONVERGENT, not event-driven: we reconcile on a
// predicate ("matches `when` AND its successor doesn't exist yet"), and
// the successor's id + contents are a pure function of (source record,
// rule). Creation is create-if-absent (`writeItem`'s `refuseOverwrite`),
// so observing the predicate N times writes the successor exactly once —
// the successor record's own existence is the "already spawned?" flag.
// No stored side-state, so fs.watch coalescing / boot re-reads / the
// wall-clock tick can all re-run this freely.
//
// All date math operates on the civil (year, month, day) triple — never
// by adding milliseconds — so month lengths and leap years are handled
// correctly. The day-of-month anchor is read from the RULE, never
// re-derived from the prior concrete date, so "31st of every month"
// never drifts (it clamps per-month at compute time, not stored
// clamped). See `advanceTriggerDate`.

import { fieldTextOrNull } from "../core/fieldText";
import { log } from "./host";
import { errorMessage, ONE_DAY_MS } from "./util";
import type { IoOptions } from "./io";
import { storeFor } from "./store";
import type { LoadedCollection } from "./discoveredCollection";
import { isFieldDrivenEvery } from "../core/schema";
import { itemIsDone } from "../core/completion";
import type { CollectionEvery, CollectionItem, CollectionSchema, CollectionSpawnEvery, CollectionWhen } from "../core/schema";

/** A timezone-free calendar date. `m` is 1-12. */
export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

const YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad4(value: number): string {
  return String(value).padStart(4, "0");
}

/** Days in `month` (1-12) of `year`, leap-year-aware. `new Date(y, m, 0)`
 *  is day 0 of the *next* month = the last day of `month`; `.getDate()`
 *  reads the civil day regardless of timezone. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Parse a `YYYY-MM-DD` string into a CivilDate, or null when the value
 *  isn't a well-formed in-range calendar date. */
export function parseCivil(raw: unknown): CivilDate | null {
  if (typeof raw !== "string") return null;
  const match = YMD_PATTERN.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { y: year, m: month, d: day };
}

/** `YYYY-MM-DD` for storage in a `date` field. */
export function formatCivil(date: CivilDate): string {
  return `${pad4(date.y)}-${pad2(date.m)}-${pad2(date.d)}`;
}

/** A monotonic integer key for a civil date (YYYYMMDD), for ordering /
 *  equality without timezone concerns. */
function ordinal(date: CivilDate): number {
  return date.y * 10000 + date.m * 100 + date.d;
}

/** Add `n` whole days to a civil date. Uses UTC epoch arithmetic so it
 *  is DST-immune (we only ever read back the civil Y/M/D). */
function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.y, date.m - 1, date.d) + days * ONE_DAY_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Advance a civil date by one `every` step. Month/year units preserve
 *  the rule's day-of-month anchor, clamped to the target month's length
 *  (no drift); day/week units do civil day arithmetic. */
export function advanceTriggerDate(source: CivilDate, every: CollectionEvery): CivilDate {
  const { unit, interval } = every;
  if (unit === "day") return addDays(source, interval);
  if (unit === "week") return addDays(source, interval * 7);
  // month / year
  const monthsToAdd = interval * (unit === "year" ? 12 : 1);
  const total = source.y * 12 + (source.m - 1) + monthsToAdd;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const dim = daysInMonth(nextYear, nextMonth);
  const anchor = every.dayOfMonth === "last" ? dim : (every.dayOfMonth ?? source.d);
  return { y: nextYear, m: nextMonth, d: Math.min(anchor, dim) };
}

/** True iff `now`'s civil date (local timezone) has reached the fire date
 *  for `triggerRaw` — i.e. the trigger date minus `leadDays` (so a 10-day
 *  lead fires 10 days early). Returns null when `triggerRaw` isn't a
 *  parseable date — callers treat that as "don't fire" and warn. */
export function isTriggerDue(triggerRaw: unknown, now: Date, leadDays = 0): boolean | null {
  const due = parseCivil(triggerRaw);
  if (due === null) return null;
  const fireDate = leadDays > 0 ? addDays(due, -leadDays) : due;
  const today: CivilDate = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  return ordinal(today) >= ordinal(fireDate);
}

const DATE_SUFFIX_PATTERN = /-\d{8}$/;

/** Deterministic successor id: `<stem>-<YYYYMMDD>`, where `<stem>` is the
 *  source id with a trailing `-YYYYMMDD` stripped if present. So a chain
 *  shares one stem and each instance is dated:
 *    `rent`           → `rent-20260610`
 *    `rent-20260610`  → `rent-20260710`
 *  Slug-safe (alphanumeric + hyphen) and a pure function of the inputs,
 *  which is what makes create-if-absent idempotent. */
export function successorId(sourceId: string, next: CivilDate): string {
  const stem = sourceId.replace(DATE_SUFFIX_PATTERN, "");
  return `${stem}-${pad4(next.y)}${pad2(next.m)}${pad2(next.d)}`;
}

/** True iff `item` satisfies the spawn predicate. With an explicit
 *  `when`, matches `String(item[when.field]) ∈ when.in`. Without one,
 *  defaults to the completion-done condition — the shared, flag-aware
 *  `itemIsDone` (core/completion; downhill import, so the module graph
 *  stays acyclic). */
function matchesWhen(when: CollectionWhen | undefined, schema: CollectionSchema, item: CollectionItem): boolean {
  if (when) {
    const raw = item[when.field];
    const text = fieldTextOrNull(raw);
    return text !== null && when.in.includes(text);
  }
  return itemIsDone(schema, item);
}

/** Resolve the literal `every` that applies to `sourceItem`. Literal-arm
 *  `spawn.every` passes through unchanged. Field-driven `spawn.every` reads
 *  `sourceItem[fromField]` and looks it up in `map`; an empty field or a
 *  value with no map entry yields null (caller skips + logs — see plan §5).
 *  Discovery rejects a map that doesn't cover the enum's values, so null
 *  here means a record that predates a map/enum edit. */
export function resolveEvery(every: CollectionSpawnEvery, sourceItem: CollectionItem): CollectionEvery | null {
  if (!isFieldDrivenEvery(every)) return every;
  const raw = sourceItem[every.fromField];
  if (raw === undefined || raw === null || raw === "") return null;
  const key = fieldTextOrNull(raw);
  // Own-property lookup, not a bare index: a record whose driver field reads
  // `constructor` / `toString` would otherwise resolve to an `Object.prototype`
  // member. `?? null` cannot catch that — a function is not undefined — so the
  // interval would flow into `advanceTriggerDate` and produce a NaN successor
  // date. Matches the own-property check `schemaRules` already uses on the same
  // map at validation time.
  if (key === null || !Object.hasOwn(every.map, key)) return null;
  return every.map[key] ?? null;
}

export interface ComputedSuccessor {
  id: string;
  record: CollectionItem;
}

/** Build the successor record purely from (schema, source record, source
 *  id). Returns null when the schema has no spawn/triggerField or the
 *  source's trigger date is unparseable. */
export function computeSuccessor(schema: CollectionSchema, sourceItem: CollectionItem, sourceId: string): ComputedSuccessor | null {
  const { spawn, triggerField } = schema;
  if (!spawn || !triggerField) return null;
  const srcDate = parseCivil(sourceItem[triggerField]);
  if (srcDate === null) return null;
  const every = resolveEvery(spawn.every, sourceItem);
  if (every === null) return null;
  const next = advanceTriggerDate(srcDate, every);
  const nextId = successorId(sourceId, next);
  const record: CollectionItem = {};
  for (const field of spawn.carry ?? []) {
    if (Object.prototype.hasOwnProperty.call(sourceItem, field)) record[field] = sourceItem[field];
  }
  Object.assign(record, spawn.set ?? {});
  record[triggerField] = formatCivil(next);
  record[schema.primaryKey] = nextId;
  return { id: nextId, record };
}

/** Warn precisely about which of `computeSuccessor`'s two null causes fired
 *  (plan §5): an unparseable source trigger date (the original cause), or a
 *  field-driven `every` whose record value has no `map` entry (a record that
 *  predates a map/enum edit — discovery rejects this statically otherwise). */
function logSpawnSkip(slug: string, triggerField: string, every: CollectionSpawnEvery, sourceItem: CollectionItem, sourceId: string): void {
  if (parseCivil(sourceItem[triggerField]) === null) {
    log.warn("collections", "spawn skipped: source trigger date unparseable", { slug, sourceId, triggerField });
    return;
  }
  const fromField = isFieldDrivenEvery(every) ? every.fromField : undefined;
  log.warn("collections", "spawn skipped: no `every` mapping for frequency value", {
    slug,
    sourceId,
    fromField,
    value: fromField === undefined ? undefined : sourceItem[fromField],
  });
}

/** Idempotently create the successor for `sourceItem` when it matches the
 *  spawn predicate. No-op when the schema declares no spawn, the
 *  predicate doesn't match, the trigger date is unparseable, or the
 *  successor already exists (create-if-absent). Never overwrites an
 *  existing successor — protects any edits the user made to it. */
export async function maybeSpawnSuccessor(collection: LoadedCollection, sourceItem: CollectionItem, sourceId: string, ioOpts: IoOptions = {}): Promise<void> {
  const { slug, schema } = collection;
  const { spawn } = schema;
  if (!spawn || !schema.triggerField) return;
  if (!matchesWhen(spawn.when, schema, sourceItem)) return;
  const computed = computeSuccessor(schema, sourceItem, sourceId);
  if (computed === null) {
    logSpawnSkip(slug, schema.triggerField, spawn.every, sourceItem, sourceId);
    return;
  }
  // Runaway guard: a successor born already matching its own `when` would
  // re-spawn on its first reconcile (and so on) — an unbounded chain. A
  // well-formed schema sets the successor to a non-matching state (e.g.
  // `set: { status: "pending" }`); refuse + warn if it doesn't. Discovery
  // also rejects this statically, so this is belt-and-suspenders.
  if (matchesWhen(spawn.when, schema, computed.record)) {
    log.warn("collections", "spawn skipped: successor would be born matching its own predicate (unbounded respawn)", {
      slug,
      sourceId,
      successorId: computed.id,
    });
    return;
  }
  try {
    // Store-mediated write: works for any writable backend (file, sqlite).
    // A read-only store can't spawn — schema validation forbids `spawn` on
    // dataSource collections, so an absent `write` is defense in depth.
    const { write } = storeFor(collection, ioOpts);
    if (!write) {
      log.warn("collections", "spawn skipped: collection store is read-only", { slug, sourceId });
      return;
    }
    const result = await write(computed.id, computed.record, { refuseOverwrite: true });
    if (result.kind === "ok") {
      log.info("collections", "spawned successor", { slug, sourceId, successorId: computed.id });
    } else if (result.kind !== "conflict") {
      // "conflict" = successor already exists = idempotent no-op (expected).
      log.warn("collections", "spawn write failed", { slug, sourceId, successorId: computed.id, kind: result.kind });
    }
  } catch (err) {
    log.warn("collections", "spawn write threw", { slug, sourceId, successorId: computed.id, error: errorMessage(err) });
  }
}
