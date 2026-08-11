// The Firestore store: a SHARED collection's records as Firestore documents.
//
// Documents live at `apps/{aid}/collections/{cid}/items/{id}`. The identity is
// `(aid, cid)`: `aid` comes from the repository's committed `app.json` and is
// resolved once by discovery (`LoadedCollection.appId`), `cid` is always the
// collection's slug. Nothing here reads a file or a session to work out WHERE —
// it is handed a settled identity and builds the path from it.
//
// WHAT PROTECTS THESE DOCUMENTS. Not the shape of the path. An earlier draft of
// this backend wrote under `users/{uid}/…` and leaned on the deployed rule
// `users/{uid}/{document=**}`, so "the schema cannot name a path" WAS the
// safety argument. It no longer is, and reading it that way would be a lie: an
// `aid` is committed in a repository that anyone with a clone can edit. What
// authorizes a read or a write is the app's MEMBER ROSTER — the rules resolve
// `request.auth.token.email` against `apps/{aid}.members` and derive a role per
// collection. Pointing at another app's `aid` is not an escape; it is a request
// that gets refused, by name, for a caller who is not on that roster.
//
// The schema still declares no path, but for a different reason: there is
// nothing for it to say. `aid` is one per app (four collections share one
// roster), and `cid` is the slug. See `StorageZ`'s firestore arm.
//
// Availability: the authenticated handle belongs to the host's remote-host
// session, so a shared collection is readable/writable only while that session
// is open. This follows sqliteStore's precedent for an unavailable engine — the
// FACTORY never throws (`storeFor` is called from ontology/validate/routes and
// must not break unrelated screens), each METHOD fails with an actionable
// message instead. It must never degrade to an empty result: "no records" and
// "not connected" have to stay distinguishable, or a disconnected session looks
// like data loss.
//
// SDK access goes through the `FirestoreDocs` seam (firestoreDocs.ts), not the
// modular functions directly — that is what makes the backend testable without
// a live Firestore.
//
// No `query`: there is no Firestore analogue of the DuckDB aggregation the CSV
// store exposes. Absent `query` is a supported state — the engine-level
// fallback (`runCollectionQuery`) answers aggregations instead.

import { isRecord } from "@mulmoclaude/common";
import { sharedCollectionKey, type SharedCollectionKey } from "../core/collectionKey";
import type { CollectionItem } from "../core/schema";
import { BackendUnavailableError } from "./backendAvailability";
import type { LoadedCollection } from "./discoveredCollection";
import { backoffDelayMs, classifyListenerError } from "../../firestore/listen";
import { firestoreHandle, log, publishCollectionChange, sharedCollectionChangePayload, type FirestoreHandle } from "./host";
import type { DeleteItemResult, IoOptions, WriteItemResult } from "./io";
import { safeRecordId } from "./paths";
import { projectItemFields, type ListOptions, type ListPage, type WriteOptions } from "./storePage";
import type { CollectionStore, StoreChangeListener, StoreUnsubscribe } from "./store";

/** What every operation throws when there is no live session. Worded as an
 *  instruction because it surfaces straight to the user and the agent. */
const NOT_CONNECTED =
  "shared collection unavailable: connect remote-host first — these records live in the app's Firestore, not in the workspace, so nothing can be read or written while the session is closed";

/** What a schema declaring `storage.type: "firestore"` must have had resolved
 *  for it before it can be served. Its absence is a programming error here, not
 *  a user-facing state: discovery REFUSES such a schema when the repository
 *  declares no `aid`, so a collection that reached this store has one. */
const NO_APP = "shared collection has no app id — discovery should have refused this schema; check that the repository's app.json declares an `aid`";

/** The records subcollection of one shared collection.
 *
 *  Takes a KEY, never loose strings, and the key is the only way to reach this
 *  function. `sharedCollectionKey` is where the name rule lives (the charset a
 *  Firestore document id, a pubsub channel segment and the completion-bell id
 *  must all survive), so building a path cannot be a way around it. */
export function sharedItemsPath(key: SharedCollectionKey): string {
  return `apps/${key.aid}/collections/${key.cid}/items`;
}

/** The collection's identity, from what discovery resolved. Throws on a
 *  missing `appId` — see NO_APP. */
function keyOf(collection: Pick<LoadedCollection, "slug" | "appId">): SharedCollectionKey {
  if (collection.appId === undefined) throw new Error(NO_APP);
  // `cid` IS the slug. Fixed here, deliberately, rather than made configurable:
  // the schema, the views and the skill text sit in a directory named by the
  // slug, so a second name would need a mapping table between what a collection
  // is called on disk and what it is called in its app — two names for one
  // thing, which is the exact collision `CollectionKey` exists to remove.
  return sharedCollectionKey(collection.appId, collection.slug);
}

function requireHandle(): FirestoreHandle {
  const handle = firestoreHandle();
  if (handle === null) throw new BackendUnavailableError(NOT_CONNECTED);
  return handle;
}

/** Firestore's own refusal, named.
 *
 *  `permission-denied` is the failure a shared collection has most often and
 *  the one the SDK explains worst ("Missing or insufficient permissions") — it
 *  says nothing about WHO was refused, which is the only fact that leads to a
 *  fix. Authorization here is the app's member roster, keyed by email, so the
 *  signed-in address is what the app's owner needs in order to add it. This is
 *  the whole reason `FirestoreHandle` carries `email`.
 *
 *  Reported as a `BackendUnavailableError` deliberately, even though it is a
 *  refusal rather than an outage: the layers above catch broadly, and without a
 *  type to test, `store.read(...).catch(() => null)` reports "record missing"
 *  and an ontology count reports 0 — a denial would read as an empty
 *  collection, which is the exact confusion this backend refuses to create. */
function isPermissionDenied(err: unknown): boolean {
  return isRecord(err) && err.code === "permission-denied";
}

function deniedMessage(key: SharedCollectionKey, email: string): string {
  return `permission denied on shared collection '${key.cid}' of app '${key.aid}' — signed in as ${email}. A shared collection is authorized by the app's member roster (by email), so this address needs a role for '${key.cid}' (or '*'); only the app's owner can add it.`;
}

/** Run one SDK call, translating a roster denial. Every read and write goes
 *  through this — a denial reaching one path and not another would mean the
 *  message a user sees depends on which screen they were on. */
async function guarded<T>(key: SharedCollectionKey, email: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isPermissionDenied(err)) throw err;
    throw new BackendUnavailableError(deniedMessage(key, email));
  }
}

/** A stored document's fields → a record. A document written by hand (or by an
 *  older version) can hold anything, so a non-object is dropped rather than
 *  surfaced as a broken record — the same fail-soft the file store applies to
 *  an unparseable `.json`. */
function toItem(data: unknown): CollectionItem | null {
  return isRecord(data) ? data : null;
}

/** Record ids are validated with the SAME helper every other backend uses.
 *  Firestore would accept ids the file store refuses, but a record should stay
 *  portable between backends — and an id that can't round-trip to a filename
 *  would break an export back to a file collection. */
function withSafeId<T>(itemId: string, onInvalid: () => T, run: (safeId: string, handle: FirestoreHandle) => T): T {
  const safeId = safeRecordId(itemId);
  if (safeId === null) return onInvalid();
  return run(safeId, requireHandle());
}

async function firestoreList(key: SharedCollectionKey): Promise<CollectionItem[]> {
  const { docs, email } = requireHandle();
  const entries = await guarded(key, email, () => docs.list(sharedItemsPath(key)));
  return entries.map((entry) => toItem(entry.data)).filter((item): item is CollectionItem => item !== null);
}

/** Paging is emulated over a full ordered read rather than pushed into
 *  Firestore: `offset` has no server-side form there (the cursor API needs the
 *  preceding document, which a stateless offset/limit call doesn't have), and
 *  `total` needs the full count anyway. Hence `nativePaging: false` — the
 *  capability is honest about the cost. */
async function firestorePage(key: SharedCollectionKey, primaryKey: string, opts: ListOptions): Promise<ListPage> {
  const items = await firestoreList(key);
  const offset = Math.max(0, opts.offset ?? 0);
  const sliced = opts.limit === undefined ? items.slice(offset) : items.slice(offset, offset + Math.max(0, opts.limit));
  return { items: projectItemFields(sliced, opts.fields, primaryKey), total: items.length, truncated: false };
}

async function firestoreRead(key: SharedCollectionKey, itemId: string): Promise<CollectionItem | null> {
  return withSafeId(
    itemId,
    () => Promise.resolve(null),
    async (safeId, { docs, email }) => toItem(await guarded(key, email, () => docs.get(sharedItemsPath(key), safeId))),
  );
}

/** Publish the "records changed" ping for a shared collection.
 *
 *  `sharedCollectionChangePayload` NEVER stamps a root, and that matters beyond
 *  tidiness: this payload is relayed to the browser and on into an
 *  LLM-generated custom-view iframe, so a filesystem path on it would be a
 *  disclosure. The type makes it unreachable rather than trusting the caller. */
function publishShared(key: SharedCollectionKey, ids: string[], operation: "upsert" | "delete"): void {
  publishCollectionChange(sharedCollectionChangePayload({ slug: key.cid, ids, op: operation }, key.aid));
}

async function firestoreWrite(
  key: SharedCollectionKey,
  itemId: string,
  item: CollectionItem,
  opts: IoOptions & { refuseOverwrite?: boolean | undefined },
): Promise<WriteItemResult> {
  return withSafeId<Promise<WriteItemResult>>(
    itemId,
    () => Promise.resolve({ kind: "invalid-id", itemId }),
    async (safeId, { docs, email }) => {
      const collectionPath = sharedItemsPath(key);
      if (opts.refuseOverwrite) {
        const created = await guarded(key, email, () => docs.create(collectionPath, safeId, item));
        if (!created) return { kind: "conflict", itemId: safeId };
      } else {
        await guarded(key, email, () => docs.set(collectionPath, safeId, item));
      }
      if (opts.slug) publishShared(key, [safeId], "upsert");
      return { kind: "ok", itemId: safeId, item };
    },
  );
}

async function firestoreDelete(key: SharedCollectionKey, itemId: string, opts: IoOptions): Promise<DeleteItemResult> {
  return withSafeId<Promise<DeleteItemResult>>(
    itemId,
    () => Promise.resolve({ kind: "invalid-id", itemId }),
    async (safeId, { docs, email }) => {
      const removed = await guarded(key, email, () => docs.delete(sharedItemsPath(key), safeId));
      if (!removed) return { kind: "not-found", itemId: safeId };
      if (opts.slug) publishShared(key, [safeId], "delete");
      return { kind: "ok", itemId: safeId };
    },
  );
}

// --- live updates -----------------------------------------------------------

/** One live subscription to a shared collection's records. */
interface SharedWatch {
  key: SharedCollectionKey;
  onChange: StoreChangeListener;
  stopped: boolean;
  detach: () => void;
  retryTimer: ReturnType<typeof setTimeout> | null;
  attempt: number;
}

/** Deliver one snapshot's changes.
 *
 *  THE FIRST SNAPSHOT IS ONE COLLECTION-LEVEL REPORT, not N per-record ones.
 *  `onSnapshot` hands over the collection's current contents immediately, as a
 *  snapshot in which every existing document reads as `added`.
 *
 *  Dropping it is wrong. There is a GAP on either side of a subscription — the
 *  boot reconcile finishes before the listener arms, and a listener that died
 *  is re-armed after a backoff — and a record that moved inside one of those
 *  gaps appears only in that first snapshot. Since this backend now HAS a
 *  `watch`, the watcher's periodic re-derivation no longer covers it, so a
 *  dropped first snapshot means stale bells and stale views until that record
 *  happens to change again. That is exactly the failure this step was supposed
 *  to remove.
 *
 *  Announcing every record individually is also wrong: it is a refresh storm
 *  to every open view, on every mount and every reconnect. `{ kind: "collection" }`
 *  says the same thing in one event — the watcher answers it with a full
 *  re-derivation plus a sweep, which is precisely "work out what changed while
 *  I was not listening".
 *
 *  A change this process made itself also arrives here — the write path has
 *  already published for it, so the record is reconciled twice. Harmless
 *  (reconciling is idempotent) and left alone: suppressing it would mean
 *  tracking our own in-flight writes, and getting that wrong loses a real
 *  change rather than a duplicate one. */
function deliverSnapshot(run: SharedWatch, ids: string[], initial: boolean): void {
  if (run.stopped) return;
  if (initial) {
    run.onChange({ kind: "collection" });
    return;
  }
  for (const itemId of ids) run.onChange({ kind: "item", itemId });
}

/** A listener died. Firestore never revives one on its own, so the choice is
 *  re-subscribe or go dark.
 *
 *  NO OVERALL RETRY WINDOW, unlike `hostRunner`'s listener. There, giving up
 *  escalates to a lifecycle owner that can re-authenticate; here there is
 *  nobody above to escalate to — the watcher registers a mounted collection
 *  once and never re-arms it, so "give up" means this collection serves stale
 *  data until the server restarts. A capped 30s re-subscribe is cheap and
 *  makes recovery automatic when the session comes back.
 *
 *  A FATAL error still stops: `permission-denied` is what a revoked membership
 *  looks like, and re-listening cannot restore a grant. It is logged as such
 *  rather than retried in silence. */
function handleWatchError(run: SharedWatch, error: unknown): void {
  if (run.stopped) return;
  if (classifyListenerError(error) === "fatal") {
    log.warn("collections", "shared collection listener stopped", {
      aid: run.key.aid,
      cid: run.key.cid,
      error: isRecord(error) && typeof error.message === "string" ? error.message : String(error),
      detail: "live updates for this collection are off until the server re-syncs; a revoked membership looks exactly like this",
    });
    return;
  }
  run.retryTimer = setTimeout(() => subscribeShared(run), backoffDelayMs(run.attempt));
  run.attempt += 1;
}

/** (Re-)arm the listener. The handle is fetched HERE rather than captured: a
 *  retry may land after the session was replaced, and listening through a
 *  closed session's handle would fail forever. */
function subscribeShared(run: SharedWatch): void {
  run.retryTimer = null;
  if (run.stopped) return;
  const handle = firestoreHandle();
  if (handle === null) {
    // Not connected yet. The steady state while remote-host is closed, so it
    // is a wait rather than an error — no log, capped backoff, and the next
    // attempt picks up the session the moment it opens.
    run.retryTimer = setTimeout(() => subscribeShared(run), backoffDelayMs(run.attempt));
    run.attempt += 1;
    return;
  }
  run.detach = handle.docs.watch(
    sharedItemsPath(run.key),
    (ids, meta) => {
      // A healthy snapshot proves the listener recovered: the ladder starts
      // fresh for whatever comes next.
      run.attempt = 0;
      deliverSnapshot(run, ids, meta.initial);
    },
    (error) => handleWatchError(run, error),
  );
}

/** Subscribe to a shared collection's records.
 *
 *  Returns `null` when there is no session: the watcher reads that as "has a
 *  watch but could not arm it", leaves the collection unmounted and retries on
 *  the next sync tick — which is the right channel for a connection that has
 *  not happened yet. Arming a dead listener instead would mark the slug mounted
 *  forever. */
function armSharedWatch(key: SharedCollectionKey, onChange: StoreChangeListener): StoreUnsubscribe | null {
  if (firestoreHandle() === null) return null;
  const run: SharedWatch = { key, onChange, stopped: false, detach: () => {}, retryTimer: null, attempt: 0 };
  subscribeShared(run);
  return () => {
    run.stopped = true;
    if (run.retryTimer !== null) clearTimeout(run.retryTimer);
    run.detach();
  };
}

/** The store factory registered for `storage.type === "firestore"`.
 *  Synchronous and connection-agnostic by contract — see the header. */
export function firestoreStoreFor(collection: LoadedCollection, opts: IoOptions): CollectionStore {
  const { primaryKey } = collection.schema;
  const ioOpts: IoOptions = { ...opts, slug: opts.slug ?? collection.slug };
  // Every method is `async` and resolves the key INSIDE itself, so a bad
  // identity rejects the one call instead of throwing out of the factory. The
  // factory is called from ontology / validate / route handlers that list many
  // collections; one that throws there takes an unrelated screen down with it.
  return {
    capabilities: { writable: true, nativeQuery: false, nativePaging: false },
    list: async () => firestoreList(keyOf(collection)),
    page: async (pageOpts = {}) => firestorePage(keyOf(collection), primaryKey, pageOpts),
    read: async (itemId: string) => firestoreRead(keyOf(collection), itemId),
    write: async (itemId: string, item: CollectionItem, writeOpts: WriteOptions = {}) =>
      firestoreWrite(keyOf(collection), itemId, item, { ...ioOpts, refuseOverwrite: writeOpts.refuseOverwrite }),
    delete: async (itemId: string) => firestoreDelete(keyOf(collection), itemId, ioOpts),
    // Having a `watch` at all is what takes this backend out of the watcher's
    // clock-tick fallback: `cannotReportChanges()` asks the store whether it
    // can report, never which backend it is, so this one line is the whole
    // change on that side.
    watch: async (onChange) => armSharedWatch(keyOf(collection), onChange),
  };
}
