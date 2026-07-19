// Bell-notification reconciler for collections whose schema declares
// `completionField`. Driven by `watcher.ts`, which calls into the
// functions below on file-system events and on boot.
//
// The model is **convergent**: a watcher event re-reads the record from
// disk and the reconciler enforces the invariant
//
//   bell entry exists for (slug, itemId)  ↔
//     schema has completionField  ∧
//     file exists  ∧
//     `String(item[completionField])` ∉ completionDoneValues
//     (∧ trigger due ∧ notifyWhen matches, when declared)
//
// Each reconcile is idempotent (`ensure*` / `clear*` no-op when state
// already matches). This is why event-type quirks of `fs.watch`
// (`rename` vs `change`, missed events, atomic-write coalescence) don't
// matter — every event re-derives the desired state from the file.
//
// Lookup uses a deterministic internal `legacyId` derived from
// `<slug>:<itemId>`, stashed on each entry's `pluginData` via the host
// adapter, so the clear path and the dedup check both find the entry
// without a side state file.

import { clear as notifierClear, listAll, publish as notifierPublish, updateForPlugin as notifierUpdate, type NotifierEntry } from "../notifier";
import { fieldText, itemIsDone, whenMatches, type CollectionItem, type CollectionSchema } from "../collection";
import {
  type DiscoveryOptions,
  type IoOptions,
  isTriggerDue,
  maybeSpawnSuccessor,
  loadCollection,
  storeFor,
  type LoadedCollection,
} from "../collection/server";
import { type CompletionPriority, errMsg, log, requireAdapter } from "./config.js";
import { evalNow } from "./clock.js";

/** The internal-id prefix every collection-completion bell entry carries.
 *  Used both to build new keys and to filter sweep candidates from the
 *  active bell. */
const LEGACY_ID_PREFIX = "collection-completion:";

/** Stable key encoding slug + item, round-tripped through the entry's
 *  `pluginData` so we can find it later without a side state file. Slug +
 *  itemId are upstream-validated via `safeSlugName`, which forbids the
 *  colon separator, so the two-segment parse below is unambiguous. */
function completionLegacyId(slug: string, itemId: string): string {
  return `${LEGACY_ID_PREFIX}${slug}:${itemId}`;
}

/** Decode a key back into its (slug, itemId) pair, or null if the string
 *  didn't originate from this module. Used by the sweep step. */
function parseCompletionLegacyId(legacyId: string): { slug: string; itemId: string } | null {
  if (!legacyId.startsWith(LEGACY_ID_PREFIX)) return null;
  const body = legacyId.slice(LEGACY_ID_PREFIX.length);
  const colon = body.indexOf(":");
  if (colon < 0) return null;
  return { slug: body.slice(0, colon), itemId: body.slice(colon + 1) };
}

/** The human-readable label shown in a completion notification's title.
 *  Uses the schema's `displayField` value when declared and non-empty;
 *  otherwise falls back to the record's primaryKey (`itemId`). */
export function resolveDisplayLabel(schema: CollectionSchema, item: CollectionItem, itemId: string): string {
  const { displayField } = schema;
  if (!displayField) return itemId;
  // Same rule as `itemLabelOf`: an array/object display field falls back to
  // the id rather than labelling the record "[object Object]".
  const label = fieldText(item[displayField]).trim();
  return label.length > 0 ? label : itemId;
}

// The done predicate moved to `../collection/core/completion` (flag-aware,
// browser-safe, shared with spawn and view filters). Re-exported so the
// `collection-watchers` barrel keeps its public surface (MulmoTerminal).
export { itemIsDone };

/** Every active bell entry whose key matches this (slug, itemId).
 *  Returns multiple when defensive cleanup is needed. Scans `listAll()`
 *  — cheap because the active set is bounded. */
async function findActiveEntries(slug: string, itemId: string): Promise<NotifierEntry[]> {
  const adapter = requireAdapter();
  const legacyId = completionLegacyId(slug, itemId);
  const entries = await listAll();
  return entries.filter((entry) => adapter.readEntry(entry.pluginData)?.legacyId === legacyId);
}

async function findActiveEntryIds(slug: string, itemId: string): Promise<string[]> {
  return (await findActiveEntries(slug, itemId)).map((entry) => entry.id);
}

/** Per-key in-flight lock. Serializes concurrent `ensureItemNotification`
 *  calls for the same (slug, itemId) so the `findActiveEntries → publish`
 *  check stays atomic across callers — not just across watcher events.
 *  `listAll` bypasses the engine's write queue, so without this lock two
 *  reconcile paths (a watcher event + a `reconcileAllItems` pass that a
 *  readdir-triggered event raced) could both miss each other's in-flight
 *  publish and produce duplicate entries. */
interface EnsureLock {
  promise: Promise<void>;
}
const ensureLocks = new Map<string, EnsureLock>();

/** Bell priority for a record: the FIRST flagged value in `notifyWhen.in`
 *  (most urgent) reads `high`, every other flagged value `normal`.
 *  Collections with no `notifyWhen` (notify for every open record) stay
 *  `normal`. */
function notifyPriorityForItem(schema: CollectionSchema, item: CollectionItem): CompletionPriority {
  const spec = schema.notifyWhen;
  if (!spec) return "normal";
  const value = item[spec.field] === undefined || item[spec.field] === null ? "" : String(item[spec.field]);
  return spec.in.indexOf(value) === 0 ? "high" : "normal";
}

async function ensureItemNotification(
  slug: string,
  schema: CollectionSchema,
  itemId: string,
  displayLabel: string,
  priority: CompletionPriority,
): Promise<void> {
  const legacyId = completionLegacyId(slug, itemId);
  // Drain any in-flight publish for this key BEFORE our check + set. The
  // drain + claim runs synchronously between `ensureLocks.get` and
  // `ensureLocks.set`, so two callers can't both observe an empty slot.

  while (true) {
    const inflight = ensureLocks.get(legacyId);
    if (!inflight) break;
    await inflight.promise;
  }
  const lock: EnsureLock = { promise: doEnsureItemNotification(slug, schema, itemId, legacyId, displayLabel, priority) };
  ensureLocks.set(legacyId, lock);
  try {
    await lock.promise;
  } finally {
    // Only clear the slot if it still points at OUR lock — a
    // sufficiently-delayed cleanup must not stomp a later claim.
    if (ensureLocks.get(legacyId) === lock) {
      ensureLocks.delete(legacyId);
    }
  }
}

/** Converge any already-present bell entries to `priority`, updating in
 *  place (preserving id / position / createdAt) so a record whose flagged
 *  value changed while it stayed pending re-colours the bell without a
 *  clear+republish flicker. No-op when the stored priority already matches. */
async function reconcileEntrySeverity(slug: string, itemId: string, entries: NotifierEntry[], priority: CompletionPriority): Promise<void> {
  const adapter = requireAdapter();
  for (const entry of entries) {
    const parsed = adapter.readEntry(entry.pluginData);
    if (!parsed || parsed.priority === priority) continue;
    await notifierUpdate(adapter.pluginPkg, entry.id, {
      severity: adapter.priorityToSeverity(priority),
      pluginData: adapter.buildPluginData({
        legacyId: parsed.legacyId,
        slug,
        itemId,
        priority,
        navigateTarget: adapter.buildNavigateTarget(slug, itemId),
      }),
    });
  }
}

async function doEnsureItemNotification(
  slug: string,
  schema: CollectionSchema,
  itemId: string,
  legacyId: string,
  displayLabel: string,
  priority: CompletionPriority,
): Promise<void> {
  const adapter = requireAdapter();
  try {
    const existing = await findActiveEntries(slug, itemId);
    if (existing.length > 0) {
      await reconcileEntrySeverity(slug, itemId, existing, priority);
      return;
    }
    const navigateTarget = adapter.buildNavigateTarget(slug, itemId);
    // `lifecycle: "action"` — these are state-of-the-world entries
    // mirroring an outstanding obligation (the item is pending), not
    // transient pings. Validation requires a non-info severity and a
    // non-empty `navigateTarget` (the slug + itemId deep-link).
    await notifierPublish({
      pluginPkg: adapter.pluginPkg,
      severity: adapter.priorityToSeverity(priority),
      lifecycle: "action",
      title: `${schema.title}: ${displayLabel}`,
      navigateTarget,
      pluginData: adapter.buildPluginData({ legacyId, slug, itemId, priority, navigateTarget }),
    });
  } catch (err) {
    log().warn("notify ensure failed", { slug, itemId, error: errMsg(err) });
  }
}

/** Idempotently clear EVERY bell entry that matches this (slug, itemId).
 *  Silent no-op when nothing matches. The "every" is defensive: if a
 *  duplicate ever slips through, this drains the lot. */
export async function clearItemNotification(slug: string, itemId: string): Promise<void> {
  try {
    const ids = await findActiveEntryIds(slug, itemId);
    for (const entryId of ids) {
      await notifierClear(entryId);
    }
  } catch (err) {
    log().warn("notify clear failed", { slug, itemId, error: errMsg(err) });
  }
}

/** Reconcile one item to the desired bell state. Re-reads the record
 *  through the collection's STORE (file, sqlite, …) so the decision is
 *  grounded in current truth, not in the event payload. Safe to call when
 *  the record is missing (delete path).
 *
 *  `ioOpts` flows into the store's workspace-containment checks —
 *  production callers (the watcher) pass nothing; tests pass
 *  `{ workspaceRoot: <tmpdir> }` so the check accepts a fixture dataDir. */
export async function reconcileItem(collection: LoadedCollection, itemId: string, ioOpts: IoOptions = {}, now: Date = evalNow()): Promise<void> {
  const { slug, schema } = collection;
  if (!schema.completionField) {
    // Schema doesn't track completion — drop any stale entry.
    await clearItemNotification(slug, itemId);
    return;
  }
  const item = await storeFor(collection, ioOpts).read(itemId);
  if (item === null) {
    await clearItemNotification(slug, itemId);
    return;
  }
  // Recurrence: predicate-gated + create-if-absent, idempotent and
  // independent of this item's own bell state. Runs before the done-clear
  // below so marking an item done still spawns its successor.
  await maybeSpawnSuccessor(collection, item, itemId, ioOpts);
  if (itemIsDone(schema, item)) {
    await clearItemNotification(slug, itemId);
    return;
  }
  // Time gate: when the schema declares `triggerField`, suppress the bell
  // until the clock reaches that date (minus `triggerLeadDays`).
  // Unparseable date ⇒ fail safe (no bell); warn ONLY when the field carries
  // a non-empty value that won't parse — an empty optional trigger date is a
  // normal state and must not spam a WARN every reconcile tick.
  if (schema.triggerField) {
    const triggerRaw = item[schema.triggerField];
    const due = isTriggerDue(triggerRaw, now, schema.triggerLeadDays);
    const isEmpty = triggerRaw === undefined || triggerRaw === null || triggerRaw === "";
    if (due === null && !isEmpty) {
      log().warn("trigger date unparseable, suppressing bell", { slug, itemId, triggerField: schema.triggerField });
    }
    if (due !== true) {
      await clearItemNotification(slug, itemId);
      return;
    }
  }
  // Condition gate: when the schema declares `notifyWhen`, only bell
  // records matching the predicate. Convergent — a record that stops
  // matching has its bell cleared.
  if (!whenMatches(schema.notifyWhen, item)) {
    await clearItemNotification(slug, itemId);
    return;
  }
  await ensureItemNotification(slug, schema, itemId, resolveDisplayLabel(schema, item, itemId), notifyPriorityForItem(schema, item));
}

/** Boot-time reconcile: walk every record of the collection once (through
 *  its store) and reconcile it. Catches up changes that happened while the
 *  server was down. Deleted items are covered by
 *  `sweepStaleActiveEntries`, not this function (it only sees records
 *  that exist). */
export async function reconcileAllItems(collection: LoadedCollection, ioOpts: IoOptions = {}, now: Date = evalNow()): Promise<void> {
  const { slug, schema } = collection;
  if (!schema.completionField) return;
  let items: CollectionItem[];
  try {
    items = await storeFor(collection, ioOpts).list();
  } catch (err) {
    log().warn("reconcile list failed", { slug, error: errMsg(err) });
    return;
  }
  const { primaryKey } = schema;
  for (const item of items) {
    const raw = item[primaryKey];
    if (typeof raw !== "string" || raw.length === 0) continue;
    await reconcileItem(collection, raw, ioOpts, now);
  }
}

/** Boot-time sweep over the active bell: drop any entries whose underlying
 *  file is gone, whose collection was deleted, whose schema no longer
 *  tracks completion, or whose item is now done. Reverse-covers the cases
 *  `reconcileAllItems` misses (it only walks files that exist). */
export async function sweepStaleActiveEntries(opts: DiscoveryOptions = {}): Promise<void> {
  const adapter = requireAdapter();
  let entries;
  try {
    entries = await listAll();
  } catch (err) {
    log().warn("sweep list failed", { error: errMsg(err) });
    return;
  }
  for (const entry of entries) {
    const own = adapter.readEntry(entry.pluginData);
    if (!own) continue;
    const parsed = parseCompletionLegacyId(own.legacyId);
    if (!parsed) continue;
    const { slug, itemId } = parsed;
    try {
      const collection = await loadCollection(slug, opts);
      if (!collection || !collection.schema.completionField) {
        await notifierClear(entry.id);
        continue;
      }
      const item = await storeFor(collection, opts).read(itemId);
      if (item === null || itemIsDone(collection.schema, item) || !whenMatches(collection.schema.notifyWhen, item)) {
        await notifierClear(entry.id);
      }
    } catch (err) {
      log().warn("sweep entry failed", { slug, itemId, error: errMsg(err) });
    }
  }
}

/** Test-only: clear the per-key in-flight locks. */
export function _resetReconcilerLocksForTesting(): void {
  ensureLocks.clear();
}
