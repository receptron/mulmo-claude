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
import { stat } from "node:fs/promises";
import { MISSED_RUN_POLICIES, SCHEDULE_TYPES } from "@receptron/task-scheduler";
import type { SystemTaskDef } from "../scheduler/adapter.js";
import type { CollectionItem } from "../collection/core/schema.js";
import { discoverCollections } from "../collection/server/discovery.js";
import { getWorkspaceRoot } from "../collection/server/host.js";
import type { LoadedCollection } from "../collection/server/discoveredCollection.js";
import type { DeleteItemResult, WriteItemResult } from "../collection/server/io.js";
import { storeFor } from "../collection/server/store.js";
import { getGoogleAccessToken } from "./auth.js";
import { canonicalCalendarId, syncCalendarEvents, CANCELLED_EVENT_STATUS, type CalendarEventSummary } from "./calendar.js";
import { withCalendarLock } from "./calendarLock.js";
import { mergeIntoExisting } from "../collection/core/project.js";
import { toCollectionRecord } from "./collectionProjection.js";
import { pushCollectionNow, unsentLocalEdits, type CalendarCollectionPushResult, type CalendarPushOutcome } from "./collectionPush.js";
import {
  claimCalendarSyncIfDue,
  clearCalendarLastSyncedAt,
  clearCalendarSyncToken,
  loadCalendarSyncToken,
  saveCalendarSyncToken,
} from "./calendarSyncStore.js";
import { calendarSyncDueWindowMs, isCalendarSyncDue } from "./calendarSyncDue.js";
import { markCalendarBackfilled, needsCalendarBackfill } from "./calendarBackfillState.js";
import { clearCalendarShadow, loadCalendarShadow, saveCalendarShadow, toShadowEvent, type ShadowEvent } from "./calendarPushState.js";
import { baselineRecord, locallyChangedFields, pushableMap } from "./pushPlan.js";
import { loadGoogleTokens } from "./tokenStore.js";
import { log } from "./host.js";

export const GOOGLE_CALENDAR_SYNC_TASK_ID = "system:google-calendar-sync";
const DEFAULT_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export interface CalendarCollectionSyncResult {
  slug: string;
  written: number;
  removed: number;
  /** Events that can NEVER be stored — e.g. an id the record-file sanitiser
   *  rejects. Reported and skipped rather than retried; see `classifyWrite`. */
  unwritable: string[];
  /** Events left alone because the record they would overwrite holds an edit
   *  Google has not seen. NOT an error — the token still advances past them; only
   *  the baseline is held back, so the next push reports the conflict (#2684). */
  withheld: string[];
  /** Retryable failures. Any of these hold the sync token back. */
  errors: string[];
}

/** `skipped` is a benign no-op; `unwritable` can never succeed so it must NOT
 *  hold the token; `error` is retryable and does hold it; `withheld` is a
 *  deliberate refusal to overwrite a local edit. */
type ApplyOutcome =
  | { kind: "written" }
  | { kind: "removed" }
  | { kind: "skipped" }
  | { kind: "withheld" }
  | { kind: "unwritable"; message: string }
  | { kind: "error"; message: string };

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

/** Whether this record still says what the workspace last saw Google say.
 *
 *  Compared against the baseline as it stood when this run STARTED READING, not
 *  as it stands now: a full re-walk clears the baseline before writing a new one
 *  (`restartFullSync`), so reading it live would answer "no baseline" for every
 *  event and protect nothing exactly when the window is widest (#2684).
 *
 *  A record with no baseline at all is NOT withheld — that is an event this
 *  workspace has never held, so there is no local edit to lose. */
export function unsentEditGuard(
  schema: LoadedCollection["schema"],
  baseline: Record<string, ShadowEvent>,
): (existing: CollectionItem, eventId: string) => boolean {
  // Built once per collection rather than per event: a full walk runs this over
  // every event the calendar has (Sourcery review #2687).
  const map = pushableMap(schema.googleCalendar?.map ?? {});
  return (existing, eventId) => {
    const shadow = baseline[eventId];
    if (shadow === undefined) return false;
    return locallyChangedFields(existing, baselineRecord(eventId, shadow, map, schema.primaryKey, schema.fields), map).length > 0;
  };
}

/** What the pull may do to the record behind one event.
 *
 *  The guard runs BEFORE the status is consulted, and that order is the whole
 *  fix: "is there something local to lose here?" outranks "what did Google do
 *  to it?". Asking about the status first is how a cancellation kept deleting
 *  records that held an edit Google had never seen (#2688), long after the
 *  same guard had been put in front of the overwrite (#2684). */
export function applyPlanFor(
  existing: CollectionItem | null,
  event: CalendarEventSummary,
  hasUnsentEdit: (existing: CollectionItem, eventId: string) => boolean,
): "withhold" | "delete" | "write" {
  if (existing !== null && hasUnsentEdit(existing, event.id)) return "withhold";
  return event.status === CANCELLED_EVENT_STATUS ? "delete" : "write";
}

/** Lay Google's mapped values over whatever the record already holds. Split out
 *  so `applyEvent` reads as read → decide → act rather than carrying the write
 *  itself (CodeRabbit review #2689). */
async function writeProjected(
  write: NonNullable<ReturnType<typeof storeFor>["write"]>,
  event: CalendarEventSummary,
  schema: LoadedCollection["schema"],
  existing: CollectionItem | null,
): Promise<ApplyOutcome> {
  const record = toCollectionRecord(event, schema.googleCalendar?.map ?? {}, schema.primaryKey, schema.fields);
  return classifyWrite(event.id, (await write(event.id, mergeIntoExisting(existing, record))).kind);
}

async function applyEvent(
  collection: LoadedCollection,
  event: CalendarEventSummary,
  workspaceRoot: string,
  hasUnsentEdit: (existing: CollectionItem, eventId: string) => boolean,
): Promise<ApplyOutcome> {
  const { schema } = collection;
  try {
    // Discovery rejects googleCalendar on a read-only (dataSource) schema,
    // so absent write/delete is defense in depth, not a live path. The store
    // threads the slug into the change publish, so an open view updates live.
    const store = storeFor(collection, { workspaceRoot });
    if (!store.write || !store.delete) return { kind: "unwritable", message: `collection '${collection.slug}' is read-only` };
    // Read and decide immediately before acting. The set computed back at push
    // time cannot cover an edit made while the window was in flight — minutes
    // of it, on a full walk (#2684).
    const existing = await store.read(event.id);
    const plan = applyPlanFor(existing, event, hasUnsentEdit);
    if (plan === "withhold") return { kind: "withheld" };
    if (plan === "delete") return classifyDelete(event.id, (await store.delete(event.id)).kind);
    return await writeProjected(store.write, event, schema, existing);
  } catch (error) {
    // A thrown IO error (EACCES, ENOSPC, …) must not abort the remaining events
    // or the other collections on this calendar — record it as retryable so the
    // token holds and the next run retries only what failed (CodeRabbit #2184).
    return { kind: "error", message: `apply ${event.id}: ${String(error)}` };
  }
}

/** The events of a window a pull may act on.
 *
 *  A record the push just refused to send is edited on BOTH sides. Writing
 *  Google's value over it destroys the local edit the push declined to resolve,
 *  so the local one stands. Single-sourced because the record write and the
 *  baseline write must agree exactly on which events they skip — disagreeing is
 *  what would silently overwrite Google on the next push (#2620). */
export function pullableEvents(events: readonly CalendarEventSummary[], unpushed: ReadonlySet<string>): CalendarEventSummary[] {
  return events.filter((event) => !unpushed.has(event.id));
}

/** Report what an automatic push did, since nobody is watching a scheduled run.
 *  A conflict or an error means that record now diverges from Google until
 *  someone resolves it, which must not be silent. */
function reportAutoPush(slug: string, result: CalendarCollectionPushResult): void {
  const { created, updated, conflicts, skipped, errors, unpushedIds } = result;
  if (created + updated > 0) log.info("google", "auto-pushed local calendar edits", { slug, created, updated });
  if (unpushedIds.length > 0) {
    log.warn("google", "records the auto push could not send — the pull will leave them alone", { slug, conflicts, unpushedIds });
  }
  if (skipped.length > 0) log.warn("google", "records the auto push skipped", { slug, skipped });
  if (errors.length > 0) log.warn("google", "auto push errors", { slug, errors });
}

/** What an automatic push protected, per collection slug. `null` means it could
 *  not be worked out at all — see `PROTECTION_UNKNOWN`. */
export type UnpushedBySlug = ReadonlyMap<string, ReadonlySet<string> | null>;

const NOTHING_UNPUSHED: ReadonlySet<string> = new Set();

/** A collection whose protection is unknown must not be pulled this run.
 *
 *  Reported through the retryable `errors` channel rather than as a special case:
 *  that already holds the sync token AND skips the baseline save, so the window
 *  simply replays next run with nothing lost. Failing OPEN here — pulling with no
 *  protection — would overwrite the very edits this exists to protect; the read
 *  that failed is no evidence that the pull's own writes would fail too, so they
 *  would land (CodeRabbit review #2666). */
export const PROTECTION_UNKNOWN = "could not work out which records to protect from the pull";

/** What ONE collection's pull must leave alone: only what ITS OWN push did not
 *  send.
 *
 *  Scoped per collection because a calendar can back several of them, and one
 *  collection's unsent edit says nothing about the others. Sharing one set across
 *  the group starved a collection that never even declares `autoPush`: a
 *  neighbour's conflict froze its records — and the sync token still advanced, so
 *  Google never resent them (Codex review #2666). */
export const unpushedFor = (unpushed: UnpushedBySlug, slug: string): ReadonlySet<string> | null => {
  const protection = unpushed.get(slug);
  return protection === undefined ? NOTHING_UNPUSHED : protection;
};

/** What the calendar's BASELINE must leave alone: the union over every
 *  collection.
 *
 *  Deliberately not per collection, unlike the records above. `.push-state.json`
 *  holds ONE baseline per calendar, shared by every collection on it, so there is
 *  no per-collection baseline to hold back. Advancing it while any collection
 *  still has an unresolved conflict is the failure that silently overwrites
 *  Google on the next push, and holding it back only ever means "keep reporting
 *  the conflict" — so the union is the safe side of an asymmetry the shared
 *  storage forces.
 *
 *  A `null` (unknown) entry contributes nothing, because that collection reports
 *  a retryable error instead — which stops the baseline being saved at all. */
export const allUnpushed = (unpushed: UnpushedBySlug): ReadonlySet<string> => new Set([...unpushed.values()].flatMap((ids) => (ids === null ? [] : [...ids])));

/** What a collection's pull must protect when its push did not run AT ALL.
 *
 *  Registering nothing here was a silent data loss of exactly the kind this
 *  feature exists to prevent: a calendar whose role degrades to reader refuses
 *  the whole push, yet the pull still runs — reading needs no write access — and
 *  overwrote every unsent local edit while advancing its baseline past it, so the
 *  next push could not even report the conflict (CodeRabbit review #2666). A
 *  collection that never declares `autoPush` is in that same state on every
 *  single run, which is how the loss reappeared without a failure in sight
 *  (#2683).
 *
 *  Protects the edited records rather than all of them, so an unchanged record
 *  keeps syncing normally. `null` when even that could not be worked out — the
 *  caller then refuses to pull the collection at all, because failing open here
 *  destroys exactly what this protects. */
async function protectUnsentEdits(collection: LoadedCollection, workspaceRoot: string, deps: PullProtectionDeps): Promise<ReadonlySet<string> | null> {
  try {
    const edited = await deps.unsentEdits(collection, workspaceRoot);
    if (edited.length > 0) log.warn("google", "protecting local edits that have not reached Google", { slug: collection.slug, edited });
    return new Set(edited);
  } catch (error) {
    log.warn("google", PROTECTION_UNKNOWN, { slug: collection.slug, error: String(error) });
    return null;
  }
}

/** The I/O the protection rule crosses, injected so every branch of it can be
 *  exercised with fakes instead of a workspace on disk and a live Google grant.
 *  The rule is what #2666 and #2683 both got wrong, so it is worth pinning. */
export interface PullProtectionDeps {
  pushNow: (collection: LoadedCollection, workspaceRoot: string) => Promise<CalendarPushOutcome>;
  unsentEdits: (collection: LoadedCollection, workspaceRoot: string) => Promise<string[]>;
}

const livePullProtectionDeps: PullProtectionDeps = { pushNow: pushCollectionNow, unsentEdits: unsentLocalEdits };

/** What ONE collection's pull must leave alone, pushing it first if it asked to
 *  be pushed.
 *
 *  A collection WITHOUT `autoPush` never pushes, so its local edits are unsent by
 *  definition — the same state a failed push leaves behind, and it needs the same
 *  protection. Pulling over them destroys the edit AND advances the baseline past
 *  it, after which no conflict can be detected any more (#2683). "The push did not
 *  run" is the condition that matters here; why it did not run is not.
 *
 *  MUST run inside the calendar lock the caller already holds — hence
 *  `pushCollectionNow` rather than `pushCalendarForCollection`, which would take
 *  the same non-reentrant lock and wait on itself forever.
 *
 *  A failed push must not stop the pull: the pull is what keeps the collection
 *  fresh, and a revoked write grant is no reason to freeze reading. */
export async function pullProtectionFor(
  collection: LoadedCollection,
  workspaceRoot: string,
  deps: PullProtectionDeps = livePullProtectionDeps,
): Promise<ReadonlySet<string> | null> {
  if (!collection.schema.googleCalendar?.autoPush) return await protectUnsentEdits(collection, workspaceRoot, deps);
  try {
    const outcome = await deps.pushNow(collection, workspaceRoot);
    if (outcome.kind === "pushed") {
      reportAutoPush(collection.slug, outcome.result);
      return new Set(outcome.result.unpushedIds);
    }
    log.warn("google", "auto push did not run", { slug: collection.slug, reason: outcome.kind });
  } catch (error) {
    log.warn("google", "auto push failed — pulling anyway", { slug: collection.slug, error: String(error) });
  }
  return await protectUnsentEdits(collection, workspaceRoot, deps);
}

/** Push the `autoPush` collections in this group, and answer with what every
 *  collection's pull must leave alone, keyed by collection. */
export async function pushAndProtect(
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
  deps: PullProtectionDeps = livePullProtectionDeps,
): Promise<UnpushedBySlug> {
  const unpushed = new Map<string, ReadonlySet<string> | null>();
  for (const collection of collections) {
    unpushed.set(collection.slug, await pullProtectionFor(collection, workspaceRoot, deps));
  }
  return unpushed;
}

async function restartFullSync(accessToken: string, calendarId: string | undefined, workspaceRoot: string) {
  await clearCalendarSyncToken(calendarId, workspaceRoot);
  // The push baseline describes the records the consumed token accounted for, so
  // it must not outlive that token — a full re-walk rewrites it from scratch.
  await clearCalendarShadow(calendarId, workspaceRoot);
  return await syncCalendarEvents(accessToken, { calendarId });
}

/** Whether a run may take the calendar, given what the shared marker says.
 *
 *  The scheduled door defers to it; every user-facing door claims regardless,
 *  because a Refresh click that silently returns nothing reads as an empty
 *  calendar, not as "another host has this". */
export type ClaimGuard = (lastSyncedAt: string | null) => boolean;

const ALWAYS_CLAIM: ClaimGuard = () => true;

/** Sync ONE calendar and fan its events out to every collection bound to it.
 *
 *  The fan-out is not an optimisation, it is correctness: the sync token is
 *  keyed by `calendarId`, so syncing collection-by-collection would let the
 *  first collection advance the shared token and leave every later collection
 *  on the same calendar reading an already-consumed window — silently missing
 *  those events forever. Fetch once, apply to all, then advance the token.
 *  (Codex + CodeRabbit review on #2184.)
 *
 *  Queued per calendar for the same reason the fan-out exists: two passes over
 *  one calendar (a Refresh click landing during the scheduled run) would each
 *  load the SAME stored token and walk the same window. That is idempotent —
 *  writes are upserts by event id — but it is a wasted full walk. Queued, the
 *  second pass resumes from the token the first just stored and fetches only
 *  what is genuinely new. That queue is module state, so it orders the doors
 *  into THIS process only; `claimThenSync` is what other hosts can see. */
export async function syncCalendarGroup(
  calendarId: string | undefined,
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
  mayClaim: ClaimGuard = ALWAYS_CLAIM,
): Promise<CalendarCollectionSyncResult[]> {
  return await withCalendarLock(calendarId, () => claimThenSync(calendarId, collections, workspaceRoot, mayClaim));
}

/** Take the workspace-shared marker BEFORE the calendar is touched, sync only if
 *  this run got it, and drop it again if the run could not happen at all.
 *
 *  Claiming first is the whole point: hosts tick in the same minute (interval
 *  schedules align to wall-clock boundaries), so a marker written on completion
 *  would leave the entire run — minutes, for a first full walk — open for a
 *  second host to start alongside this one and lose the push baseline it writes.
 *
 *  Released only when the sync could not run at all. A run that finished with
 *  retryable per-collection errors KEEPS the marker: it already held the token
 *  and the baseline back, so it replays on the next tick either way, and
 *  releasing would hand a permanently-failing calendar back to both hosts at
 *  once — the very overlap this guards (observed during Claude review). */
async function claimThenSync(
  calendarId: string | undefined,
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
  mayClaim: ClaimGuard,
): Promise<CalendarCollectionSyncResult[]> {
  if (!(await claimCalendarSync(calendarId, workspaceRoot, mayClaim))) {
    log.info("google", "skipping a calendar this workspace synced recently — another host may be on it", { calendarId });
    return [];
  }
  try {
    return await syncCalendarGroupNow(calendarId, collections, workspaceRoot);
  } catch (error) {
    await releaseCalendarSyncClaim(calendarId, workspaceRoot);
    throw error;
  }
}

/** Never throws, and fails OPEN: the marker guards against duplicate work, it is
 *  not a precondition for syncing correctly. A workspace that cannot store it
 *  syncs the way it did before #2678. */
async function claimCalendarSync(calendarId: string | undefined, workspaceRoot: string, mayClaim: ClaimGuard): Promise<boolean> {
  try {
    return await claimCalendarSyncIfDue(calendarId, new Date().toISOString(), mayClaim, workspaceRoot);
  } catch (error) {
    log.warn("google", "could not stamp the calendar sync marker — another host may sync this calendar in parallel", { calendarId, error: String(error) });
    return true;
  }
}

async function releaseCalendarSyncClaim(calendarId: string | undefined, workspaceRoot: string): Promise<void> {
  try {
    await clearCalendarLastSyncedAt(calendarId, workspaceRoot);
  } catch (error) {
    log.warn("google", "could not release the calendar sync marker after a failed run", { calendarId, error: String(error) });
  }
}

/** Every event whose baseline must NOT advance: what the push could not send,
 *  plus what the apply refused to overwrite.
 *
 *  The two must agree exactly. The apply's refusals only became visible after it
 *  ran, so they join the union here rather than at push time — leaving them out
 *  would advance the baseline past a record the pull deliberately left holding a
 *  local edit, which is the silent overwrite this whole path exists to stop. */
export const heldBack = (unpushed: UnpushedBySlug, results: readonly CalendarCollectionSyncResult[]): ReadonlySet<string> =>
  new Set([...allUnpushed(unpushed), ...results.flatMap((result) => result.withheld)]);

/** The collections in this group that have never received the whole calendar,
 *  by slug. Asked of each collection's OWN records (`calendarBackfillState.ts`),
 *  because the sync token cannot answer it — it is keyed by calendar and shared
 *  by every consumer of that calendar (#2850). */
export async function collectionsNeedingBackfill(collections: readonly LoadedCollection[]): Promise<string[]> {
  const checked = await Promise.all(
    collections.map(async (collection) => {
      const pending = await needsCalendarBackfill(collection.dataDir, collection.schema.googleCalendar?.calendarId);
      return pending ? collection.slug : null;
    }),
  );
  return checked.filter((slug): slug is string => slug !== null);
}

/** The token this run may resume from — none while any collection in the group
 *  still needs the whole calendar.
 *
 *  A stored token says how far THE CALENDAR has been read, by whoever read it:
 *  the standalone `google` tool's `calendarSync`, or a sibling collection that
 *  synced before this one existed. Resuming from it hands a brand-new collection
 *  a delta of a window it never received — a handful of records, reported as a
 *  success with no error, and never the history the docs promise (#2850).
 *
 *  The full walk fans out to the whole group, which is free: writes are upserts,
 *  so the collections that were already current simply rewrite what they hold. */
export async function resumableToken(
  calendarId: string | undefined,
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
): Promise<string | undefined> {
  const pending = await collectionsNeedingBackfill(collections);
  if (pending.length === 0) return (await loadCalendarSyncToken(calendarId, workspaceRoot)) ?? undefined;
  log.info("google", "walking the whole calendar — these collections have never received it", { calendarId, collections: pending });
  return undefined;
}

/** Record the backfill for every collection the window landed in. Called only
 *  after a FULL walk that fully landed: marking one after an incremental window
 *  would claim a history the records do not hold. */
async function markGroupBackfilled(calendarId: string | undefined, collections: readonly LoadedCollection[]): Promise<void> {
  const walkedAt = new Date().toISOString();
  await Promise.all(collections.map((collection) => markCalendarBackfilled(collection.dataDir, collection.schema.googleCalendar?.calendarId, walkedAt)));
}

/** What a partial window reports. Names the cause the user can actually act on:
 *  a page guard is reached when Google has to expand an enormous number of
 *  recurring instances, and one series with no end date is enough. */
export const PARTIAL_CALENDAR_WINDOW =
  "Google returned more pages of events than one sync pass walks, so only part of the calendar was copied. " +
  "Give any recurring event with no end date a finite end date, then sync again.";

/** A truncated walk must not read as a completed one (#2850).
 *
 *  Added AFTER the token/baseline gate, not through it. A short fetch is not a
 *  failed write: the events that did arrive are Google's own and landed
 *  correctly, so their baseline is true and holding it back would freeze them —
 *  a record with no baseline reads as an unsent local edit, which the next pull
 *  then refuses to touch (#2683). What must not happen is the walk claiming
 *  completeness, and that is covered without the gate: `nextSyncToken` only
 *  appears on Google's last page, so a truncated walk has no token to advance,
 *  and the backfill marker is withheld separately. */
export const withPartialWindowError = (results: readonly CalendarCollectionSyncResult[], pagesExhausted: boolean): CalendarCollectionSyncResult[] =>
  pagesExhausted ? results.map((result) => ({ ...result, errors: [...result.errors, PARTIAL_CALENDAR_WINDOW] })) : [...results];

/** What a finished window is allowed to advance.
 *
 *  One pure rule rather than three conditions spread through the write-back,
 *  because the three answers genuinely differ and each wrong one is a SILENT
 *  data bug rather than a visible failure: a baseline held back freezes the
 *  records it describes (#2683), a baseline advanced past a failed write hides
 *  a conflict (#2620), a backfill marker set on a partial walk re-creates the
 *  #2850 gap, and a token advanced past either loses the window for good. */
export interface WindowAdvance {
  /** Record what Google now says, so the next push can tell a local edit from a pull. */
  baseline: boolean;
  /** Claim these records now hold the WHOLE calendar. */
  backfill: boolean;
  /** Move the shared cursor past this window. */
  token: boolean;
}

/** `landed` is the write-side verdict (`windowFullyLanded`); the rest describe
 *  the window Google returned.
 *
 *  A page-capped walk (`pagesExhausted`) keeps its baseline — the events that
 *  arrived are Google's own and were written correctly — but must NOT claim the
 *  backfill, or the collection would stop asking for the rest of its calendar.
 *  Its token is refused too, though Google makes that moot by sending
 *  `nextSyncToken` only on the last page. */
export function windowAdvance(window: { landed: boolean; walkedInFull: boolean; pagesExhausted: boolean; nextSyncToken?: string | undefined }): WindowAdvance {
  if (!window.landed) return { baseline: false, backfill: false, token: false };
  const complete = !window.pagesExhausted;
  return { baseline: true, backfill: window.walkedInFull && complete, token: complete && window.nextSyncToken !== undefined };
}

/** The window this run should read, and whether it was a full walk. A 410
 *  restart is a full walk too, so it backfills just as well as a forced one. */
async function readWindow(
  calendarId: string | undefined,
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
): Promise<{ result: Awaited<ReturnType<typeof syncCalendarEvents>>; walkedInFull: boolean }> {
  const accessToken = await getGoogleAccessToken();
  const resumeFrom = await resumableToken(calendarId, collections, workspaceRoot);
  const first = await syncCalendarEvents(accessToken, { calendarId, syncToken: resumeFrom });
  const result = first.fullResyncRequired ? await restartFullSync(accessToken, calendarId, workspaceRoot) : first;
  if (result.pagesExhausted) {
    log.warn("google", "the calendar walk ran out of pages — only part of it was copied", { calendarId, events: result.events.length });
  }
  return { result, walkedInFull: resumeFrom === undefined || first.fullResyncRequired };
}

async function syncCalendarGroupNow(
  calendarId: string | undefined,
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
): Promise<CalendarCollectionSyncResult[]> {
  // Push BEFORE the window is fetched, so a local edit is already in Google when
  // the pull reads it: the record then comes back holding Google's own canonical
  // value, and the baseline agrees with both. Pulling first would overwrite the
  // very edit that was waiting to go up (#2620).
  const unpushed = await pushAndProtect(collections, workspaceRoot);

  // Snapshot AFTER the push and BEFORE the window is read. After, because the
  // push writes a baseline per record it sends, and an earlier snapshot would
  // read those records as locally edited. Before, because `restartFullSync`
  // clears the baseline — the snapshot is what survives that clear and lets the
  // apply still tell an edit from an untouched record (#2684).
  const baseline = await loadCalendarShadow(calendarId, workspaceRoot);

  const { result, walkedInFull } = await readWindow(calendarId, collections, workspaceRoot);
  const applied = await applyWindowToGroup(collections, result.events, workspaceRoot, unpushed, baseline);
  const advance = windowAdvance({
    landed: windowFullyLanded(calendarId, applied),
    walkedInFull,
    pagesExhausted: result.pagesExhausted,
    nextSyncToken: result.nextSyncToken,
  });

  if (advance.baseline) await saveCalendarShadow(calendarId, shadowUpdates(result.events, heldBack(unpushed, applied), baseline), workspaceRoot);
  if (advance.backfill) await markGroupBackfilled(calendarId, collections);
  if (advance.token && result.nextSyncToken) await advanceToken(calendarId, result.nextSyncToken, collections, workspaceRoot);
  return withPartialWindowError(applied, result.pagesExhausted);
}

/** Apply one window to every collection on the calendar, honouring what each
 *  one's own push protected. A collection whose protection could not be worked
 *  out is not pulled at all — it reports a retryable error instead, which holds
 *  the token and the baseline back for the whole group. */
async function applyWindowToGroup(
  collections: readonly LoadedCollection[],
  events: readonly CalendarEventSummary[],
  workspaceRoot: string,
  unpushed: UnpushedBySlug,
  baseline: Record<string, ShadowEvent>,
): Promise<CalendarCollectionSyncResult[]> {
  const results: CalendarCollectionSyncResult[] = [];
  for (const collection of collections) {
    const protection = unpushedFor(unpushed, collection.slug);
    results.push(
      protection === null
        ? { slug: collection.slug, written: 0, removed: 0, unwritable: [], withheld: [], errors: [PROTECTION_UNKNOWN] }
        : await applyEventsToCollection(collection, events, workspaceRoot, protection, baseline),
    );
  }
  return results;
}

/** Whether the token and baseline may advance past this window.
 *
 *  Google never resends a window, so advancing past a failed write would lose
 *  those events for good; holding the token back just replays them next run
 *  (writes are idempotent). An `unwritable` event can never succeed, so it does
 *  NOT hold the token — but it is logged loudly, since it will silently never
 *  appear in the collection. */
function windowFullyLanded(calendarId: string | undefined, results: readonly CalendarCollectionSyncResult[]): boolean {
  // Logged per collection, not flattened across the group: a calendar can back
  // several, and "one of them is stuck" is unactionable without the slug — the
  // more so now that `autoPush` runs this unattended (CodeRabbit review #2666).
  results
    .filter((entry) => entry.unwritable.length > 0)
    .forEach((entry) =>
      log.warn("google", "skipping calendar events that can never be stored", { calendarId, slug: entry.slug, unwritable: entry.unwritable }),
    );
  // A withheld event is a decision, not a failure: the record kept a local edit
  // Google has not seen, so re-fetching the window would only refuse it again.
  // The token advances past it and the BASELINE is what holds back, which is
  // what keeps the next push able to report the conflict (#2684).
  results
    .filter((entry) => entry.withheld.length > 0)
    .forEach((entry) =>
      log.warn("google", "leaving calendar records alone — they hold edits Google has not seen", { calendarId, slug: entry.slug, withheld: entry.withheld }),
    );
  const failed = results.filter((entry) => entry.errors.length > 0);
  failed.forEach((entry) => log.warn("google", "holding back calendar sync token after failed writes", { calendarId, slug: entry.slug, errors: entry.errors }));
  return failed.length === 0;
}

/** The baseline this window establishes: what Google now says per event, and
 *  `null` for a cancelled one so a recreate cannot resume from a dead baseline.
 *
 *  An event whose record the push could not send is left OUT, and that omission
 *  is load-bearing. Advancing its baseline to Google's new value while the record
 *  keeps the local one would make the next push read a plain one-sided edit —
 *  no conflict to detect any more — and quietly overwrite Google. Held back, the
 *  baseline stays older than both sides, so the conflict keeps being reported
 *  until someone resolves it (#2620).
 *
 *  `held` carries what those events must KEEP. Omitting them is enough on an
 *  incremental run, where the file is merged rather than replaced — but a full
 *  re-walk CLEARS the baseline first (`restartFullSync`), and there omission
 *  drops the entry for good. The next push would then read a conflicted record
 *  as a brand-new create, hit Google's duplicate-id 409 and refuse it, instead
 *  of reporting the conflict it actually is. Re-stating the pre-run value makes
 *  a held-back event behave the same either way (observed during Claude review;
 *  no bot flagged it). */
export function shadowUpdates(
  events: readonly CalendarEventSummary[],
  unpushed: ReadonlySet<string> = new Set(),
  held: Record<string, ShadowEvent> = {},
): Record<string, ShadowEvent | null> {
  const advanced = pullableEvents(events, unpushed).map((event): [string, ShadowEvent | null] => [
    event.id,
    event.status === CANCELLED_EVENT_STATUS ? null : toShadowEvent(event),
  ]);
  const kept = [...unpushed].flatMap((eventId): [string, ShadowEvent][] => (held[eventId] === undefined ? [] : [[eventId, held[eventId]]]));
  return Object.fromEntries([...kept, ...advanced]);
}

/** Save the window's token unless every collection that consumed it was deleted
 *  while the sync was in flight.
 *
 *  The sync opens with a `discoverCollections()` snapshot, so a delete landing
 *  mid-run has already cleared this calendar's token by the time we get here
 *  (`releaseOrphanedCalendarToken`). Saving anyway would resurrect exactly the
 *  orphan the delete removed, and the next collection on this calendar would
 *  resume from a token describing records it never received (#2428).
 *
 *  One survivor is enough: it still needs the incremental position. */
async function advanceToken(
  calendarId: string | undefined,
  nextSyncToken: string,
  collections: readonly LoadedCollection[],
  workspaceRoot: string,
): Promise<void> {
  if (!(await anySyncedCollectionSurvives(collections))) {
    log.info("google", "not advancing the sync token — every collection on this calendar was deleted mid-sync", { calendarId });
    return;
  }
  await saveCalendarSyncToken(calendarId, nextSyncToken, workspaceRoot);
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
}

/** Liveness of the collections a sync just wrote to, checked against the skill
 *  dir `deleteCollection` removes. `exists` is injected so the rule is testable
 *  without a filesystem. An empty group has no survivor by definition. */
export async function anySyncedCollectionSurvives(
  collections: readonly Pick<LoadedCollection, "skillDir">[],
  exists: (absPath: string) => Promise<boolean> = pathExists,
): Promise<boolean> {
  // A subscribed collection has no directory on this machine, so it can never
  // be the thing keeping a sync alive — it is not a skill this host installed.
  const alive = await Promise.all(collections.map((collection) => (collection.skillDir === null ? Promise.resolve(false) : exists(collection.skillDir))));
  return alive.some(Boolean);
}

async function applyEventsToCollection(
  collection: LoadedCollection,
  events: readonly CalendarEventSummary[],
  workspaceRoot: string,
  unpushed: ReadonlySet<string>,
  baseline: Record<string, ShadowEvent>,
): Promise<CalendarCollectionSyncResult> {
  const hasUnsentEdit = unsentEditGuard(collection.schema, baseline);
  const attempts: { eventId: string; outcome: ApplyOutcome }[] = [];
  for (const event of pullableEvents(events, unpushed)) {
    attempts.push({ eventId: event.id, outcome: await applyEvent(collection, event, workspaceRoot, hasUnsentEdit) });
  }
  const outcomes = attempts.map((attempt) => attempt.outcome);
  return {
    slug: collection.slug,
    written: outcomes.filter((outcome) => outcome.kind === "written").length,
    removed: outcomes.filter((outcome) => outcome.kind === "removed").length,
    withheld: attempts.flatMap((attempt) => (attempt.outcome.kind === "withheld" ? [attempt.eventId] : [])),
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

/** The minimum a value needs for the orphan check: just the calendar it reads.
 *  Structural so the rule can be exercised without building a LoadedCollection. */
export interface CalendarDeclaring {
  googleCalendar?: { calendarId?: string | undefined } | undefined;
}

/** The canonical calendar whose sync token nothing needs any more, or null.
 *
 *  Sync tokens are keyed by calendar, NOT by collection, so a deleted
 *  collection's token outlives it. Recreating a collection on the same calendar
 *  then resumes from that token and receives only the delta — the new
 *  collection never gets the history (#2428).
 *
 *  Returns null while ANY remaining collection still reads that calendar:
 *  clearing a live calendar's token costs a full re-walk on the next sync. The
 *  comparison is on the CANONICAL id for the same reason `groupByCalendar` is —
 *  an omitted `calendarId` and an explicit `"primary"` are one calendar. */
export function orphanedCalendarId(deleted: CalendarDeclaring, remaining: readonly CalendarDeclaring[]): string | null {
  if (!deleted.googleCalendar) return null;
  const key = canonicalCalendarId(deleted.googleCalendar.calendarId);
  const stillRead = remaining.some((other) => other.googleCalendar && canonicalCalendarId(other.googleCalendar.calendarId) === key);
  return stillRead ? null : key;
}

/** Drop the sync token of a just-deleted collection's calendar, unless another
 *  collection still reads it. Call AFTER the delete lands — the check reads the
 *  collections that survive it.
 *
 *  Returns the cleared calendar id, or null when nothing was cleared. Never
 *  throws: a failed cleanup must not fail the delete it follows. */
export async function releaseOrphanedCalendarToken(deleted: CalendarDeclaring, workspaceRoot: string): Promise<string | null> {
  try {
    if (!deleted.googleCalendar) return null;
    const remaining = await discoverCollections({ workspaceRoot });
    const orphaned = orphanedCalendarId(
      deleted,
      remaining.map((collection) => collection.schema),
    );
    if (orphaned === null) return null;
    await clearCalendarSyncToken(orphaned, workspaceRoot);
    await clearCalendarShadow(orphaned, workspaceRoot);
    await clearCalendarLastSyncedAt(orphaned, workspaceRoot);
    log.info("google", "cleared the sync token of a calendar no collection reads any more", { calendarId: orphaned });
    return orphaned;
  } catch (error) {
    log.warn("google", "could not release the deleted collection's calendar sync token", { error: String(error) });
    return null;
  }
}

/** Every declaring collection, grouped by the calendar it reads. */
async function declaringGroups(workspaceRoot: string): Promise<Map<string, LoadedCollection[]>> {
  const all = await discoverCollections({ workspaceRoot });
  return groupByCalendar(all.filter((collection) => collection.schema.googleCalendar));
}

/** Whether a background sync of these groups may run at all.
 *
 *  Authoring the collection before linking the account is an expected state,
 *  not a failure. Checking once here keeps it a quiet skip instead of an
 *  access-token throw per calendar, every hour, until the user links (#2188).
 *  A user-triggered sync answers differently — it says so out loud.
 *
 *  Deliberately not phrased as a per-host state: the link lives in
 *  `~/.config/mulmo`, which carries no app name, so every host on the machine
 *  shares one answer. Reading it as "linked on this host only" is what made the
 *  calendar look implicitly exclusive when it never was (#2678). */
async function backgroundSyncAllowed(groups: Map<string, LoadedCollection[]>): Promise<boolean> {
  if (groups.size === 0) return false;
  if (await isGoogleLinked()) return true;
  log.info("google", "skipping calendar sync — no Google account linked", { calendars: groups.size });
  return false;
}

/** Run each group, isolating failures per calendar — one unreachable calendar
 *  (or a revoked grant) must not stop the others. `mayClaim` is evaluated per
 *  calendar as it comes up, never once for the whole map: an earlier calendar's
 *  full walk takes minutes, and a decision made before it started says nothing
 *  about who holds this one now. */
async function runCalendarGroups(
  groups: Map<string, LoadedCollection[]>,
  workspaceRoot: string,
  mayClaim: ClaimGuard = ALWAYS_CLAIM,
): Promise<CalendarCollectionSyncResult[]> {
  const results: CalendarCollectionSyncResult[] = [];
  for (const [calendarId, collections] of groups) {
    try {
      results.push(...(await syncCalendarGroup(calendarId, collections, workspaceRoot, mayClaim)));
    } catch (error) {
      log.warn("google", "calendar sync failed", { calendarId, error: String(error) });
      results.push(
        ...collections.map((collection) => ({ slug: collection.slug, written: 0, removed: 0, unwritable: [], withheld: [], errors: [String(error)] })),
      );
    }
  }
  return results;
}

/** Sync every collection whose calendar is due — no host in this workspace has
 *  started one within `intervalMs` (#2678). Without that gate this walked every
 *  declaring group on every tick, so a second host registering the same task
 *  simply doubled the runs, concurrently.
 *
 *  Dueness is not decided here, only described: the guard is handed down and
 *  evaluated where the marker is written, so the answer cannot go stale between
 *  deciding and claiming (Codex review #2680). */
export async function syncDueCalendarCollections(
  workspaceRoot: string,
  intervalMs: number = DEFAULT_SYNC_INTERVAL_MS,
): Promise<CalendarCollectionSyncResult[]> {
  const groups = await declaringGroups(workspaceRoot);
  if (!(await backgroundSyncAllowed(groups))) return [];
  const windowMs = calendarSyncDueWindowMs(intervalMs);
  return await runCalendarGroups(groups, workspaceRoot, (lastSyncedAt) => isCalendarSyncDue(lastSyncedAt, windowMs));
}

/** The groups holding a collection that still needs the whole calendar.
 *
 *  This used to ask whether the CALENDAR had a stored token, which is not the
 *  same question and is why the trigger silently did nothing for the #2850
 *  reporter: their calendar already had a token — from the standalone `google`
 *  tool, and on later attempts from the collection they had just deleted by
 *  hand — so the brand-new collection matched nothing and its first sync never
 *  ran at all. `pending` is injected so the rule is testable without a
 *  workspace on disk.
 *
 *  Still self-silencing: a landed full walk marks its collections, so a group
 *  stops matching once every collection in it holds the history. */
export async function groupsNeedingBackfill<T>(groups: Map<string, T>, pending: (value: T) => Promise<boolean>): Promise<Map<string, T>> {
  const checked = await Promise.all([...groups].map(async (entry) => ((await pending(entry[1])) ? entry : null)));
  return new Map(checked.filter((entry): entry is [string, T] => entry !== null));
}

/** Sync only the calendars a collection has never received in full — the first
 *  sync for a just-created collection, which otherwise stays empty until the
 *  hourly scheduler run (#2427). Cheap and safe to call on every config write. */
export async function syncNewCalendarCollections(workspaceRoot: string): Promise<CalendarCollectionSyncResult[]> {
  const groups = await declaringGroups(workspaceRoot);
  const pending = await groupsNeedingBackfill(groups, async (collections) => (await collectionsNeedingBackfill(collections)).length > 0);
  if (!(await backgroundSyncAllowed(pending))) return [];
  log.info("google", "running the first sync for calendars a collection has never received in full", { calendars: [...pending.keys()] });
  return await runCalendarGroups(pending, workspaceRoot);
}

/** A user-triggered sync's outcome. `not-a-calendar` and `not-linked` are
 *  states the caller must report rather than swallow: a Refresh click that
 *  quietly returns "0 written" reads as an empty calendar, not as a setup gap. */
export type ManualCalendarSyncOutcome = { kind: "synced"; results: CalendarCollectionSyncResult[] } | { kind: "not-a-calendar" } | { kind: "not-linked" };

/** The I/O a manual sync crosses, injectable so the three outcomes can be
 *  exercised with fakes instead of a workspace on disk and a live Google grant
 *  (CodeRabbit review #2566). */
export interface ManualCalendarSyncDeps {
  loadGroups: (workspaceRoot: string) => Promise<Map<string, LoadedCollection[]>>;
  isLinked: () => Promise<boolean>;
  runGroups: (groups: Map<string, LoadedCollection[]>, workspaceRoot: string) => Promise<CalendarCollectionSyncResult[]>;
}

const liveManualSyncDeps: ManualCalendarSyncDeps = { loadGroups: declaringGroups, isLinked: isGoogleLinked, runGroups: runCalendarGroups };

/** Sync the calendar ONE collection reads, on demand (the Refresh button).
 *
 *  Deliberately syncs the whole group, not just `slug`: the sync token is keyed
 *  by calendar, so consuming a window for one collection would leave the others
 *  on that calendar reading an already-consumed one. Returns every result of the
 *  group so the caller can report the requested slug's own counts.
 *
 *  "Does this collection sync at all" is answered BEFORE "is Google linked":
 *  telling someone to link their account for a collection that never declared a
 *  calendar sends them fixing the wrong thing. */
export async function syncCalendarForCollection(
  slug: string,
  workspaceRoot: string,
  deps: ManualCalendarSyncDeps = liveManualSyncDeps,
): Promise<ManualCalendarSyncOutcome> {
  const groups = await deps.loadGroups(workspaceRoot);
  const owning = [...groups].filter(([, collections]) => collections.some((collection) => collection.slug === slug));
  if (owning.length === 0) return { kind: "not-a-calendar" };
  if (!(await deps.isLinked())) return { kind: "not-linked" };
  return { kind: "synced", results: await deps.runGroups(new Map(owning), workspaceRoot) };
}

/** The interval this task is scheduled on right now. A non-interval schedule
 *  cannot be reached — the factory below builds an interval one — but the type
 *  allows it, so it falls back rather than asserting. */
function scheduledIntervalMs(task: SystemTaskDef): number {
  return task.schedule.type === SCHEDULE_TYPES.interval ? task.schedule.intervalMs : DEFAULT_SYNC_INTERVAL_MS;
}

/** Scheduler registration, shaped like `feedRefreshTaskDef` so hosts wire it
 *  with a single line.
 *
 *  `run` reads the interval back off the definition instead of closing over the
 *  option: a host rewrites `schedule` from its own overrides file AFTER this
 *  returns, and the due window has to follow it. Frozen at the default, a
 *  shortened interval would tick often and skip nearly every tick. */
export function googleCalendarSyncTaskDef(opts?: { workspaceRoot?: string; intervalMs?: number }): SystemTaskDef {
  const def: SystemTaskDef = {
    id: GOOGLE_CALENDAR_SYNC_TASK_ID,
    name: "Google Calendar sync",
    description: "Pulls changed Google Calendar events into any collection declaring `googleCalendar`, without invoking the LLM.",
    schedule: { type: SCHEDULE_TYPES.interval, intervalMs: opts?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS },
    missedRunPolicy: MISSED_RUN_POLICIES.runOnce,
    run: () => syncDueCalendarCollections(opts?.workspaceRoot ?? getWorkspaceRoot(), scheduledIntervalMs(def)).then(() => {}),
  };
  return def;
}
