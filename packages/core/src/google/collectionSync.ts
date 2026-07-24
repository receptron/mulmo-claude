// LLM-free Google Calendar → collection sync (#2095).
//
// The whole point of #2095 is that syncing must not cost tokens: this path
// runs on the scheduler, calls the Calendar REST API directly, and writes
// records itself. No chat, no agent, no MCP round-trip.
//
// Destination is not hardcoded — a collection opts in by declaring
// `googleCalendar` in its schema, exactly the way a feed opts in by declaring
// `ingest`. There is no preset calendar collection (the standalone Calendar
// view was removed in 0.7.0); the user asks for one and the agent authors it.
import { MISSED_RUN_POLICIES, SCHEDULE_TYPES } from "@receptron/task-scheduler";
import type { SystemTaskDef } from "../scheduler/adapter.js";
import { discoverCollections } from "../collection/server/discovery.js";
import { getWorkspaceRoot } from "../collection/server/host.js";
import type { LoadedCollection } from "../collection/server/discoveredCollection.js";
import type { DeleteItemResult, WriteItemResult } from "../collection/server/io.js";
import { storeFor } from "../collection/server/store.js";
import type { CollectionFieldSpec, CollectionItem } from "../collection/core/schema.js";
import type { GOOGLE_CALENDAR_SOURCE_FIELDS } from "../collection/core/schemaZ.js";
import { getGoogleAccessToken } from "./auth.js";
import { canonicalCalendarId, syncCalendarEvents, type CalendarEventSummary } from "./calendar.js";
import { toCollectionDateTime } from "./collectionDateTime.js";
import { clearCalendarSyncToken, loadCalendarSyncToken, saveCalendarSyncToken } from "./calendarSyncStore.js";
import { loadGoogleTokens } from "./tokenStore.js";
import { log } from "./host.js";

export const GOOGLE_CALENDAR_SYNC_TASK_ID = "system:google-calendar-sync";
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const CANCELLED_STATUS = "cancelled";

export interface CalendarCollectionSyncResult {
  slug: string;
  written: number;
  removed: number;
  /** Events that can NEVER be stored — e.g. an id the record-file sanitiser
   *  rejects. Reported and skipped rather than retried; see `classifyWrite`. */
  unwritable: string[];
  /** Retryable failures. Any of these hold the sync token back. */
  errors: string[];
}

/** The event fields a schema may map from — narrowed to real keys of
 *  `CalendarEventSummary` so the projection below needs no cast. */
type GoogleCalendarSourceField = (typeof GOOGLE_CALENDAR_SOURCE_FIELDS)[number];

const DATETIME_FIELD_TYPE = "datetime";

/** Own-property lookup, mirroring what the record lint reads: a spec reachable
 *  only through the prototype chain is not a DECLARED field, so it must not
 *  decide how a value is stored. */
function declaredSpec(fields: Record<string, CollectionFieldSpec>, field: string): CollectionFieldSpec | undefined {
  return Object.hasOwn(fields, field) ? fields[field] : undefined;
}

/** Google's raw value is normalised only into a field the schema declares as
 *  `datetime` — that is the type whose stored shape the record lint, the
 *  calendar grid and the day view all parse (#2310). A user who maps `start`
 *  onto a `string` field asked for Google's value verbatim and keeps it. */
function projectValue(fields: Record<string, CollectionFieldSpec>, field: string, value: string): unknown {
  return declaredSpec(fields, field)?.type === DATETIME_FIELD_TYPE ? toCollectionDateTime(value) : value;
}

/** Project one Google event onto the collection's own field names. The
 *  primary field always takes the event id — upsert-by-id is what keeps the
 *  sync idempotent, so it is deliberately not remappable. */
export function toCollectionRecord(
  event: CalendarEventSummary,
  map: Record<string, GoogleCalendarSourceField>,
  primaryKey: string,
  fields: Record<string, CollectionFieldSpec>,
): CollectionItem {
  const mapped = Object.entries(map).map(([field, source]) => [field, projectValue(fields, field, event[source])]);
  return { ...Object.fromEntries(mapped), [primaryKey]: event.id };
}

/** `skipped` is a benign no-op; `unwritable` can never succeed so it must NOT
 *  hold the token; `error` is retryable and does hold it. */
type ApplyOutcome =
  { kind: "written" } | { kind: "removed" } | { kind: "skipped" } | { kind: "unwritable"; message: string } | { kind: "error"; message: string };

// `writeItem` / `deleteItem` report most failures by RETURNING a non-`ok` kind
// rather than throwing. Ignoring that would let the token advance past events
// that never landed, and Google never resends them (Codex review #2184).
//
// But not every failure is worth retrying: an id the record-file sanitiser
// rejects can never become valid, so holding the token for it would re-fetch
// the same window forever and permanently kill that calendar's sync — far
// worse than dropping the one event. Google's own ids are base32hex and pass,
// but an imported/client-set id may contain characters the sanitiser refuses.
// (Observed during Claude review, not flagged by a bot.)
export function classifyWrite(eventId: string, kind: WriteItemResult["kind"]): ApplyOutcome {
  if (kind === "ok") return { kind: "written" };
  if (kind === "invalid-id") return { kind: "unwritable", message: `write ${eventId}: invalid-id` };
  return { kind: "error", message: `write ${eventId}: ${kind}` };
}

export function classifyDelete(eventId: string, kind: DeleteItemResult["kind"]): ApplyOutcome {
  if (kind === "ok") return { kind: "removed" };
  // Cancelling an event we never stored is normal, not a failure.
  if (kind === "not-found") return { kind: "skipped" };
  if (kind === "invalid-id") return { kind: "unwritable", message: `delete ${eventId}: invalid-id` };
  return { kind: "error", message: `delete ${eventId}: ${kind}` };
}

async function applyEvent(collection: LoadedCollection, event: CalendarEventSummary, workspaceRoot: string): Promise<ApplyOutcome> {
  const { schema } = collection;
  try {
    // Discovery rejects googleCalendar on a read-only (dataSource) schema,
    // so absent write/delete is defense in depth, not a live path. The store
    // threads the slug into the change publish, so an open view updates live.
    const store = storeFor(collection, { workspaceRoot });
    if (!store.write || !store.delete) return { kind: "unwritable", message: `collection '${collection.slug}' is read-only` };
    if (event.status === CANCELLED_STATUS) {
      const deleted = await store.delete(event.id);
      return classifyDelete(event.id, deleted.kind);
    }
    const record = toCollectionRecord(event, schema.googleCalendar?.map ?? {}, schema.primaryKey, schema.fields);
    const written = await store.write(event.id, record);
    return classifyWrite(event.id, written.kind);
  } catch (error) {
    // A thrown IO error (EACCES, ENOSPC, …) must not abort the remaining events
    // or the other collections on this calendar — record it as retryable so the
    // token holds and the next run retries only what failed (CodeRabbit #2184).
    return { kind: "error", message: `apply ${event.id}: ${String(error)}` };
  }
}

async function restartFullSync(accessToken: string, calendarId: string | undefined, workspaceRoot: string) {
  await clearCalendarSyncToken(calendarId, workspaceRoot);
  return await syncCalendarEvents(accessToken, { calendarId });
}

/** Sync ONE calendar and fan its events out to every collection bound to it.
 *
 *  The fan-out is not an optimisation, it is correctness: the sync token is
 *  keyed by `calendarId`, so syncing collection-by-collection would let the
 *  first collection advance the shared token and leave every later collection
 *  on the same calendar reading an already-consumed window — silently missing
 *  those events forever. Fetch once, apply to all, then advance the token.
 *  (Codex + CodeRabbit review on #2184.) */
export async function syncCalendarGroup(
  calendarId: string | undefined,
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
): Promise<CalendarCollectionSyncResult[]> {
  const accessToken = await getGoogleAccessToken();
  const storedToken = await loadCalendarSyncToken(calendarId, workspaceRoot);
  const first = await syncCalendarEvents(accessToken, { calendarId, syncToken: storedToken ?? undefined });
  const result = first.fullResyncRequired ? await restartFullSync(accessToken, calendarId, workspaceRoot) : first;

  const results: CalendarCollectionSyncResult[] = [];
  for (const collection of collections) {
    results.push(await applyEventsToCollection(collection, result.events, workspaceRoot));
  }
  // Advance the token only after every collection in the group consumed the
  // window AND every record actually landed. Google never resends a window, so
  // advancing past a failed write would lose those events for good; holding the
  // token back just replays them next run (writes are idempotent).
  const unwritable = results.flatMap((entry) => entry.unwritable);
  if (unwritable.length > 0) {
    // Never retryable, so the token still advances — but say so loudly, since
    // these events will silently never appear in the collection.
    log.warn("google", "skipping calendar events that can never be stored", { calendarId, unwritable });
  }
  const failed = results.flatMap((entry) => entry.errors);
  if (result.nextSyncToken && failed.length === 0) {
    await saveCalendarSyncToken(calendarId, result.nextSyncToken, workspaceRoot);
  } else if (failed.length > 0) {
    log.warn("google", "holding back calendar sync token after failed writes", { calendarId, failed: failed.length });
  }
  return results;
}

async function applyEventsToCollection(
  collection: LoadedCollection,
  events: readonly CalendarEventSummary[],
  workspaceRoot: string,
): Promise<CalendarCollectionSyncResult> {
  const outcomes: ApplyOutcome[] = [];
  for (const event of events) {
    outcomes.push(await applyEvent(collection, event, workspaceRoot));
  }
  return {
    slug: collection.slug,
    written: outcomes.filter((outcome) => outcome.kind === "written").length,
    removed: outcomes.filter((outcome) => outcome.kind === "removed").length,
    unwritable: outcomes.flatMap((outcome) => (outcome.kind === "unwritable" ? [outcome.message] : [])),
    errors: outcomes.flatMap((outcome) => (outcome.kind === "error" ? [outcome.message] : [])),
  };
}

/** A refresh token is what lets the scheduler run unattended; without one
 *  there is nothing to sync with. */
async function isGoogleLinked(): Promise<boolean> {
  return Boolean((await loadGoogleTokens())?.refresh_token);
}

/** Group the declaring collections by the calendar they read, so each calendar
 *  is fetched exactly once.
 *
 *  Keyed by the CANONICAL id, not the declared one: an omitted `calendarId` and
 *  an explicit `"primary"` address the same calendar and therefore share one
 *  sync token, so grouping them apart would let one group advance the token out
 *  from under the other — the very loss this grouping exists to prevent
 *  (Codex review #2184). */
export function groupByCalendar(collections: readonly LoadedCollection[]): Map<string, LoadedCollection[]> {
  const groups = new Map<string, LoadedCollection[]>();
  for (const collection of collections) {
    const key = canonicalCalendarId(collection.schema.googleCalendar?.calendarId);
    groups.set(key, [...(groups.get(key) ?? []), collection]);
  }
  return groups;
}

/** Sync every collection that declares `googleCalendar`. Failures are isolated
 *  per calendar — one unreachable calendar (or a revoked grant) must not stop
 *  the others. */
export async function syncDueCalendarCollections(workspaceRoot: string): Promise<CalendarCollectionSyncResult[]> {
  const all = await discoverCollections({ workspaceRoot });
  const declaring = all.filter((collection) => collection.schema.googleCalendar);
  if (declaring.length === 0) return [];
  // Authoring the collection before linking the account is an expected state,
  // not a failure. Checking once here keeps it a quiet skip instead of an
  // access-token throw per calendar, every hour, until the user links (#2188).
  if (!(await isGoogleLinked())) {
    log.info("google", "skipping calendar sync — no Google account linked on this host", { collections: declaring.length });
    return [];
  }
  const results: CalendarCollectionSyncResult[] = [];
  for (const [calendarId, collections] of groupByCalendar(declaring)) {
    try {
      results.push(...(await syncCalendarGroup(calendarId, collections, workspaceRoot)));
    } catch (error) {
      log.warn("google", "calendar sync failed", { calendarId, error: String(error) });
      results.push(...collections.map((collection) => ({ slug: collection.slug, written: 0, removed: 0, unwritable: [], errors: [String(error)] })));
    }
  }
  return results;
}

/** Scheduler registration, shaped like `feedRefreshTaskDef` so hosts wire it
 *  with a single line. */
export function googleCalendarSyncTaskDef(opts?: { workspaceRoot?: string; intervalMs?: number }): SystemTaskDef {
  return {
    id: GOOGLE_CALENDAR_SYNC_TASK_ID,
    name: "Google Calendar sync",
    description: "Pulls changed Google Calendar events into any collection declaring `googleCalendar`, without invoking the LLM.",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS },
    missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
    run: () => syncDueCalendarCollections(opts?.workspaceRoot ?? getWorkspaceRoot()).then(() => {}),
  };
}
