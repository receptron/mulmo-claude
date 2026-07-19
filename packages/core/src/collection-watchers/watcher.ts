// Filesystem watchers that drive collection-completion bell
// notifications AND the live-refresh change event. One `fs.watch` per
// discovered collection's `dataDir`, fanned out from a single boot call
// + a 30-second re-discovery interval that catches newly-created /
// deleted collections (there is no in-process "collections changed"
// event broadcast).
//
// Why a watcher, not just route hooks: the canonical pattern for
// collection-skills has the agent Write records directly with the Write
// tool — that path never hits the REST API, so a route-level hook would
// miss most of the traffic the user generates. The watcher catches every
// mutation regardless of who wrote the file.
//
// That same reasoning is why the watcher publishes change events: a
// write through `io.ts` publishes its own (immediately, and reliably
// even where fs.watch is unavailable), but a direct file write has no
// other producer, so open views would never refresh. Both producers
// firing for one `io.ts` write is intentional — the payload carries no
// bodies, so a duplicate costs one redundant refetch, whereas a missed
// event leaves the UI silently stale.
//
// All decisions live in `reconciler.ts`; this module is pure plumbing:
// discover, mkdir, fs.watch, forward events into the reconciler. Every
// reconcile call is idempotent so fs.watch's well-known quirks (`rename`
// vs `change`, atomic-write coalescence, filename === null on some
// platforms) don't need special handling.

import { watch, type FSWatcher } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { discoverCollections, itemFilePath, loadCollection, publishCollectionChange, type DiscoveryOptions, type LoadedCollection } from "../collection/server";
import type { CollectionSchema } from "../collection";
import { errMsg, log } from "./config.js";
import { evalNow } from "./clock.js";
import { reconcileAllItems, reconcileItem, sweepStaleActiveEntries } from "./reconciler.js";

// Collections don't get added / removed rapidly; 30 s is a comfortable
// upper bound on how long a new schema can sit before its watcher is up.
const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const REDISCOVERY_INTERVAL_MS = 30 * ONE_SECOND_MS;

// Wall-clock tick that re-reconciles time-dependent collections (those
// declaring `triggerField` and/or `spawn`). The fs.watcher only re-runs
// the reconciler on FILE changes; a `triggerField` bell that should fire
// "when the clock reaches date X" — and a `spawn` whose successor's own
// trigger later comes due — change no file at that moment, so a periodic
// re-derivation is required.
const TRIGGER_TICK_INTERVAL_MS = ONE_MINUTE_MS;

interface CollectionWatcher {
  slug: string;
  dataDir: string;
  watcher: FSWatcher;
  /** Last-seen serialized schema for change detection. When a rediscovery
   *  tick observes a different value, the watcher's items are reconciled
   *  and the cache is refreshed — this catches schema-only edits (e.g.
   *  flipping `completionField` on or off) that don't touch any record
   *  file and would otherwise leave bell state stale indefinitely. */
  schemaJson: string;
  /** The discovered collection this watcher was mounted for — what the
   *  reconciler needs to pick the right STORE (file records vs a sqlite
   *  `storage` db). Refreshed whenever `schemaJson` is. */
  collection: LoadedCollection;
}

const watchers = new Map<string, CollectionWatcher>();
let rediscoveryTimer: ReturnType<typeof setInterval> | null = null;
let triggerTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
/** Discovery options threaded into every `discoverCollections` /
 *  `loadCollection` / `sweepStaleActiveEntries` call. Production: empty
 *  (live workspace). Tests: `{ workspaceRoot, userSkillsDir }` pointing
 *  at a fixture tree. Module-level so per-event handlers can read it
 *  without threading through every signature. */
let discoveryOpts: DiscoveryOptions = {};

/** Per-key single-flight slot (declared here so `stopCollectionWatchers`
 *  can clear it during teardown). */
interface ReconcileSlot {
  running: Promise<void>;
  pending: boolean;
}
const itemSlots = new Map<string, ReconcileSlot>();

/** Per-slug single-flight for a storage (db-file) collection's full
 *  reconcile pass — a burst of db writes collapses to one pass + one
 *  trailing re-run, mirroring the per-item slots of the file watcher. */
const storageSlots = new Map<string, ReconcileSlot>();

/** Trailing debounce per dataSource collection: an atomic file replace
 *  (Excel save, editor rename) surfaces as 2-3 fs events — collapse them
 *  into one change publish so live views refetch once. */
const DATA_SOURCE_DEBOUNCE_MS = 300;
const dataSourceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Test-only configuration knobs. Production callers pass nothing and get
 *  the live workspace defaults; tests pass a tmpdir-rooted `discoveryOpts`
 *  and override the tick cadences (or set them to `null` to disable the
 *  auto-ticks so the test drives sync manually). */
export interface CollectionWatcherOptions {
  discoveryOpts?: DiscoveryOptions;
  rediscoveryIntervalMs?: number | null;
  triggerTickIntervalMs?: number | null;
}

/** Boot entry point: sweep stale active entries, then mount watchers for
 *  every discovered collection and arm the periodic re-discovery poll.
 *  Idempotent — a second call is a no-op. */
export async function startCollectionWatchers(opts: CollectionWatcherOptions = {}): Promise<void> {
  if (started) return;
  // `started` only flips on AFTER boot finishes. If sweep or syncWatchers
  // throws mid-boot, reset state on failure so a supervisor / test
  // harness can retry instead of being permanently latched.
  discoveryOpts = opts.discoveryOpts ?? {};
  try {
    // Boot reconcile is split in two: sweep first (drop bell entries whose
    // files / collections / schemas vanished while the server was down),
    // then `syncWatchers` runs the per-collection forward fill. Both paths
    // are idempotent and converge on the same end state.
    await sweepStaleActiveEntries(discoveryOpts);
    await syncWatchers();
    const intervalMs = opts.rediscoveryIntervalMs === undefined ? REDISCOVERY_INTERVAL_MS : opts.rediscoveryIntervalMs;
    if (intervalMs !== null) {
      rediscoveryTimer = setInterval(() => {
        syncWatchers().catch((err: unknown) => {
          log().warn("watcher rediscovery failed", { error: errMsg(err) });
        });
      }, intervalMs);
      // `unref` so a clean process exit isn't blocked waiting for the tick.
      rediscoveryTimer.unref();
    }
    const triggerMs = opts.triggerTickIntervalMs === undefined ? TRIGGER_TICK_INTERVAL_MS : opts.triggerTickIntervalMs;
    if (triggerMs !== null) {
      triggerTimer = setInterval(() => {
        tickTimeTriggers().catch((err: unknown) => {
          log().warn("watcher trigger tick failed", { error: errMsg(err) });
        });
      }, triggerMs);
      triggerTimer.unref();
    }
    started = true;
  } catch (err) {
    discoveryOpts = {};
    throw err;
  }
}

/** Tear down every watcher and stop the intervals. Used by tests;
 *  production never calls this (process exit reclaims the fds). Resets
 *  `started` so a subsequent `startCollectionWatchers` re-mounts. */
export async function stopCollectionWatchers(): Promise<void> {
  if (rediscoveryTimer) {
    clearInterval(rediscoveryTimer);
    rediscoveryTimer = null;
  }
  if (triggerTimer) {
    clearInterval(triggerTimer);
    triggerTimer = null;
  }
  for (const watcher of watchers.values()) {
    try {
      watcher.watcher.close();
    } catch {
      /* fs.watch close is best-effort */
    }
  }
  watchers.clear();
  itemSlots.clear();
  storageSlots.clear();
  for (const timer of dataSourceTimers.values()) clearTimeout(timer);
  dataSourceTimers.clear();
  discoveryOpts = {};
  started = false;
}

/** Test-only: manually trigger one rediscovery + reconcile pass. */
export async function _syncWatchersForTesting(): Promise<void> {
  await syncWatchers();
}

/** Test-only: drive one wall-clock tick synchronously, with an optional
 *  injected clock. */
export async function _tickTimeTriggersForTesting(now?: Date): Promise<void> {
  await tickTimeTriggers(now);
}

/** Re-reconcile every watched collection that depends on the clock — i.e.
 *  declares `triggerField` (a bell that fires at a date) and/or `spawn`
 *  (recurrence whose successors come due over time). Collections with
 *  neither are skipped. Idempotent. The schema is parsed back from the
 *  watcher's cached `schemaJson` to avoid a per-tick disk read. */
async function tickTimeTriggers(now: Date = evalNow()): Promise<void> {
  for (const entry of watchers.values()) {
    let schema: CollectionSchema;
    try {
      schema = JSON.parse(entry.schemaJson) as CollectionSchema;
    } catch (err) {
      log().warn("trigger tick: bad cached schema", { slug: entry.slug, error: errMsg(err) });
      continue;
    }
    // dataSource collections have no reconcilable records (and zod
    // forbids `spawn` on them) — the clock never changes their state.
    if (schema.dataSource !== undefined) continue;
    if (!schema.triggerField && !schema.spawn) continue;
    await reconcileAllItems(entry.collection, discoveryOpts, now);
  }
}

/** Reconcile the watcher set against the currently-discovered
 *  collections. Adds watchers for new slugs (with a boot reconcile of
 *  their items), drops watchers for vanished slugs, and re-reconciles
 *  items for collections whose schema changed. Runs a final sweep when
 *  this tick changed the watcher set or any schema. */
async function syncWatchers(): Promise<void> {
  let collections;
  try {
    collections = await discoverCollections(discoveryOpts);
  } catch (err) {
    log().warn("watcher discover failed", { error: errMsg(err) });
    return;
  }
  const liveSlugs = new Set(collections.map((collection) => collection.slug));
  const vanishedMutated = stopVanishedWatchers(liveSlugs);
  const schemaMutated = await reconcileChangedSchemas(collections);
  const addedMutated = await startNewWatchers(collections);
  if (vanishedMutated || schemaMutated || addedMutated) {
    await sweepStaleActiveEntries(discoveryOpts);
  }
}

function stopVanishedWatchers(liveSlugs: Set<string>): boolean {
  let mutated = false;
  for (const slug of [...watchers.keys()]) {
    if (liveSlugs.has(slug)) continue;
    const watcher = watchers.get(slug);
    if (watcher) {
      try {
        watcher.watcher.close();
      } catch {
        /* best-effort */
      }
    }
    watchers.delete(slug);
    mutated = true;
    log().info("watcher stopped", { slug });
  }
  return mutated;
}

/** True when a schema edit moved the collection's storage — a different
 *  `dataSource.path`, a different `dataPath`, or a flip between the two
 *  modes. The mounted fs.watch is bound to the OLD location, so it must
 *  be remounted, not just re-reconciled. */
function storagePathChanged(previousJson: string, next: LoadedCollection["schema"]): boolean {
  let previous: LoadedCollection["schema"];
  try {
    previous = JSON.parse(previousJson) as LoadedCollection["schema"];
  } catch {
    return true; // unreadable cache — remount to be safe
  }
  return (
    previous.dataSource?.path !== next.dataSource?.path ||
    previous.dataPath !== next.dataPath ||
    previous.storage?.type !== next.storage?.type ||
    storageFilePath(previous.storage) !== storageFilePath(next.storage)
  );
}

/** The on-disk path of a storage backend, or undefined when it has none
 *  (firestore keeps records off the filesystem, so there is no mount to
 *  move — only a `type` change matters for it). */
function storageFilePath(storage: LoadedCollection["schema"]["storage"]): string | undefined {
  return storage?.type === "sqlite" ? storage.path : undefined;
}

/** Re-reconcile already-watched collections whose schema changed since
 *  the last tick. New collections fall through to `startNewWatchers`. */
async function reconcileChangedSchemas(collections: readonly LoadedCollection[]): Promise<boolean> {
  let mutated = false;
  for (const collection of collections) {
    const existing = watchers.get(collection.slug);
    if (!existing) continue;
    const nextJson = JSON.stringify(collection.schema);
    if (existing.schemaJson === nextJson) continue;
    if (storagePathChanged(existing.schemaJson, collection.schema)) {
      // Drop the stale mount; `startNewWatchers` (which runs right after
      // this pass in syncWatchers) remounts on the new location. A
      // dataSource collection also gets a change ping so open views
      // refetch against the new file immediately.
      log().info("watcher storage path changed, remounting", { slug: collection.slug });
      try {
        existing.watcher.close();
      } catch {
        /* best-effort */
      }
      watchers.delete(collection.slug);
      if (collection.schema.dataSource !== undefined) publishCollectionChange({ slug: collection.slug, op: "upsert" });
      mutated = true;
      continue;
    }
    existing.schemaJson = nextJson;
    existing.collection = collection;
    if (collection.schema.dataSource !== undefined) {
      // No record files to reconcile — but a schema edit can change what
      // the views render (fields, displayField, …), so ping them.
      log().info("dataSource watcher schema changed, publishing", { slug: collection.slug });
      publishCollectionChange({ slug: collection.slug, op: "upsert" });
      mutated = true;
      continue;
    }
    log().info("watcher schema changed, re-reconciling", { slug: collection.slug });
    await reconcileAllItems(collection, discoveryOpts);
    mutated = true;
  }
  return mutated;
}

async function startNewWatchers(collections: readonly LoadedCollection[]): Promise<boolean> {
  let mutated = false;
  for (const collection of collections) {
    if (watchers.has(collection.slug)) continue;
    if (collection.schema.dataSource !== undefined) await startDataSourceWatcher(collection);
    else if (collection.schema.storage !== undefined) await startStorageWatcher(collection);
    else await startWatcherFor(collection);
    mutated = true;
  }
  return mutated;
}

/** Publish one (debounced) change event for a dataSource collection —
 *  live views refetch the whole collection; no per-row diffing. */
function scheduleDataSourcePublish(slug: string): void {
  const existing = dataSourceTimers.get(slug);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    dataSourceTimers.delete(slug);
    publishCollectionChange({ slug, op: "upsert" });
  }, DATA_SOURCE_DEBOUNCE_MS);
  timer.unref?.();
  dataSourceTimers.set(slug, timer);
}

/** Watch a dataSource collection's external data file. The watch mounts
 *  on the PARENT directory (watching the file itself goes stale after an
 *  atomic replace — the inode changes) and filters events to the file's
 *  basename; a null filename (platform quirk) is treated as a hit. No
 *  reconciler involvement — replacing the CSV just refreshes the views. */
async function startDataSourceWatcher(collection: LoadedCollection): Promise<void> {
  const file = collection.dataSourceFile;
  if (file === undefined) return;
  const dir = path.dirname(file);
  const base = path.basename(file);
  try {
    await mkdir(dir, { recursive: true });
    const watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
      if (filename !== null && filename !== base) return;
      scheduleDataSourcePublish(collection.slug);
    });
    watcher.on("error", (err) => {
      log().warn("dataSource watcher error", { slug: collection.slug, error: errMsg(err) });
    });
    watchers.set(collection.slug, { slug: collection.slug, dataDir: dir, watcher, schemaJson: JSON.stringify(collection.schema), collection });
    log().info("dataSource watcher started", { slug: collection.slug, file });
  } catch (err) {
    log().warn("dataSource watcher start failed", { slug: collection.slug, error: errMsg(err) });
  }
}

/** Watch a `storage` collection's database file. One db file holds every
 *  record, so an event can't name WHICH record changed — each (debounced)
 *  event runs a full `reconcileAllItems` pass (bells / spawn) plus a
 *  change publish so views refetch after EXTERNAL edits too (host writes
 *  already publish their own change events; the extra ping is debounced
 *  and idempotent). Mounts on the parent dir, same as the dataSource
 *  watcher, so an atomic replace can't strand the watch. */
async function startStorageWatcher(collection: LoadedCollection): Promise<void> {
  const file = collection.storageFile;
  if (file === undefined) return;
  const dir = path.dirname(file);
  const base = path.basename(file);
  try {
    await mkdir(dir, { recursive: true });
    await reconcileAllItems(collection, discoveryOpts);
    const watcher = watch(dir, { persistent: false }, (_eventType, rawFilename) => {
      // fs.watch can hand back a Buffer on some platforms despite the
      // string typing — stringify defensively (a Buffer has no startsWith,
      // so calling it directly would throw inside the callback and crash).
      const filename = rawFilename === null ? null : String(rawFilename);
      // Null filename (platform quirk) counts as a hit; otherwise accept
      // the db itself plus its sqlite sidecars (`<db>-wal`, `<db>-journal`).
      if (filename !== null && !filename.startsWith(base)) return;
      scheduleStorageReconcile(collection.slug).catch((err: unknown) => {
        log().warn("storage watcher reconcile failed", { slug: collection.slug, error: errMsg(err) });
      });
    });
    watcher.on("error", (err) => {
      log().warn("storage watcher error", { slug: collection.slug, error: errMsg(err) });
    });
    watchers.set(collection.slug, { slug: collection.slug, dataDir: dir, watcher, schemaJson: JSON.stringify(collection.schema), collection });
    log().info("storage watcher started", { slug: collection.slug, file });
  } catch (err) {
    log().warn("storage watcher start failed", { slug: collection.slug, error: errMsg(err) });
  }
}

function scheduleStorageReconcile(slug: string): Promise<void> {
  return runSingleFlight(storageSlots, slug, async () => {
    const collection = await loadCollection(slug, discoveryOpts);
    if (!collection) return;
    await reconcileAllItems(collection, discoveryOpts);
    // One db file holds every record, so a DELETED row leaves no per-item
    // event — sweep the active bell so its entry converges like a
    // file-backed delete does (same pairing as the unknown-filename path).
    await sweepStaleActiveEntries(discoveryOpts);
    publishCollectionChange({ slug, op: "upsert" });
  });
}

/** Test-only: drive one storage-collection reconcile pass directly. */
export function _scheduleStorageReconcileForTesting(slug: string): Promise<void> {
  return scheduleStorageReconcile(slug);
}

async function startWatcherFor(collection: LoadedCollection): Promise<void> {
  const { slug, schema, dataDir } = collection;
  try {
    // `fs.watch` throws on a missing dir, so ensure it exists. New
    // collections legitimately start with no records — mkdir is the
    // canonical first-use bootstrap.
    await mkdir(dataDir, { recursive: true });
    // Boot reconcile this collection's existing items BEFORE mounting the
    // watcher: a pending item the user added during downtime needs its
    // bell entry even if no event fires today.
    await reconcileAllItems(collection, discoveryOpts);
    const watcher = watch(dataDir, { persistent: false }, (_eventType, filename) => {
      // Errors from inside the callback would propagate as unhandled
      // rejections — wrap so a single bad event can't unwind the watcher.
      onEvent(slug, filename).catch((err: unknown) => {
        log().warn("watcher event failed", { slug, filename, error: errMsg(err) });
      });
    });
    watcher.on("error", (err) => {
      log().warn("watcher error", { slug, error: errMsg(err) });
    });
    watchers.set(slug, { slug, dataDir, watcher, schemaJson: JSON.stringify(schema), collection });
    log().info("watcher started", { slug, dataDir });
  } catch (err) {
    log().warn("watcher start failed", { slug, error: errMsg(err) });
  }
}

/** Test-only: the per-key single-flight scheduler. Exported so test code
 *  can drive rapid-fire calls directly and observe the trailing coalesce
 *  — `fs.watch` event timing is too flaky to assert against.
 *
 *  Single-flight semantics: while a reconcile is in flight for a given
 *  (slug, itemId), additional events on the same key set `pending = true`
 *  and return — the running reconcile re-runs once after it completes.
 *  This collapses fs.watch's rapid-fire bursts (atomic rename surfaces as
 *  2-3 events) into a single reconcile + one trailing re-run. */
export function _scheduleItemReconcileForTesting(collection: LoadedCollection, itemId: string): Promise<void> {
  return scheduleItemReconcile(collection, itemId);
}

function scheduleItemReconcile(collection: LoadedCollection, itemId: string): Promise<void> {
  return runSingleFlight(
    itemSlots,
    `${collection.slug}\x00${itemId}`,
    () => reconcileItem(collection, itemId, discoveryOpts),
    () => publishItemChange(collection, itemId),
  );
}

/** The shared single-flight loop behind both schedulers. Re-runs `pass`
 *  while events keep arriving — the trailing re-run captures any state
 *  change that landed during a prior pass. After each pass we read
 *  `pending` and zero it before the next iteration, so an event that
 *  fires *during* the last pass's await still triggers one more pass
 *  before the slot is freed. `onSettled`, if given, runs once in the
 *  `finally` after the slot is freed — the item scheduler uses it to
 *  publish exactly one live-refresh event per burst. */
function runSingleFlight(slots: Map<string, ReconcileSlot>, key: string, pass: () => Promise<void>, onSettled?: () => Promise<void>): Promise<void> {
  const existing = slots.get(key);
  if (existing) {
    existing.pending = true;
    return existing.running;
  }
  const slot: ReconcileSlot = { running: Promise.resolve(), pending: false };
  slot.running = (async () => {
    try {
      let keepGoing = true;
      while (keepGoing) {
        slot.pending = false;
        await pass();
        keepGoing = slot.pending;
      }
    } finally {
      slots.delete(key);
      // `onSettled` runs once after the slot is freed — the slot is the
      // coalescing primitive, so one burst yields one call. It's in the
      // `finally` because a failed reconcile still means a file changed,
      // and open views must be told to refetch either way.
      if (onSettled) await onSettled();
    }
  })();
  slots.set(key, slot);
  return slot.running;
}

/** Emit the live-refresh event for one record. `op` is derived from
 *  whether the file is still there — `fs.watch` reports neither the kind
 *  of change nor, reliably, which of `rename`/`change` means what. Only
 *  file-backed collections reach here; a `storage` (db) collection has no
 *  per-record file and publishes wholesale in `scheduleStorageReconcile`. */
async function publishItemChange(collection: LoadedCollection, itemId: string): Promise<void> {
  const changeOp = (await itemFileExists(collection.dataDir, itemId)) ? "upsert" : "delete";
  safePublish({ slug: collection.slug, ids: [itemId], op: changeOp });
}

async function itemFileExists(dataDir: string, itemId: string): Promise<boolean> {
  try {
    await access(itemFilePath(dataDir, itemId));
    return true;
  } catch {
    return false;
  }
}

/** The publisher is host-supplied, so treat it as untrusted: a throw here
 *  runs inside a `finally` and would mask the reconcile's own error. */
function safePublish(payload: { slug: string; ids?: string[]; op?: "upsert" | "delete" }): void {
  try {
    publishCollectionChange(payload);
  } catch (err) {
    log().warn("collection change publish failed", { slug: payload.slug, error: errMsg(err) });
  }
}

/** Handle a single fs.watch event. Re-loads the collection (schema may
 *  have changed since startup), filters out non-record files, and
 *  forwards to the single-flighted reconciler. `filename === null` (rare,
 *  platform-specific) triggers a full directory rescan to be safe. */
async function onEvent(slug: string, filename: string | Buffer | null): Promise<void> {
  const collection = await loadCollection(slug, discoveryOpts);
  if (!collection) return;
  if (filename === null) {
    // Some platforms omit the filename on a watch event — we don't know
    // which record changed. `reconcileAllItems` covers items whose file
    // still exists; pair it with a sweep so any record deleted inside the
    // same opaque event has its stale bell entry cleared too.
    try {
      await reconcileAllItems(collection, discoveryOpts);
      await sweepStaleActiveEntries(discoveryOpts);
    } finally {
      // In `finally` for the same reason as the per-item path: a failed
      // reconcile still means a file changed. No id and no op — subscribers
      // refetch the whole collection anyway, and guessing either would lie.
      safePublish({ slug });
    }
    return;
  }
  const name = typeof filename === "string" ? filename : filename.toString("utf-8");
  // Filter: only record files (`*.json`), skip dot-prefixed (atomic
  // writes / OS metadata / editor swap files). The reconciler is
  // idempotent so a stray non-record event would be harmless, but
  // skipping early avoids needless I/O.
  if (!name.endsWith(".json") || name.startsWith(".")) return;
  const itemId = name.slice(0, -".json".length);
  await scheduleItemReconcile(collection, itemId);
}
