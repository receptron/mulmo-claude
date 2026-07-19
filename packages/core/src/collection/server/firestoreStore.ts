// The Firestore store: a collection's records as Firestore documents.
//
// Documents live at `users/{uid}/collections/{slug}/items/{id}`. The uid
// comes from the host's live session — never from the schema — because the
// deployed security rules grant a user exactly `users/{uid}/{document=**}`,
// and a schema-supplied path could point outside it. That is also why
// `StorageZ`'s firestore variant carries no `path`.
//
// Availability: the authenticated handle belongs to the host's remote-host
// session, so a firestore collection is readable/writable only while that
// session is open. This follows sqliteStore's precedent for an unavailable
// engine — the FACTORY never throws (storeFor is called from
// ontology/validate/routes and must not break unrelated screens), each
// METHOD fails with an actionable message instead. It must never degrade to
// an empty result: "no records" and "not connected" have to stay
// distinguishable, or a disconnected session looks like data loss.
//
// SDK access goes through the `FirestoreDocs` seam (firestoreDocs.ts), not
// the modular functions directly — that is what makes the backend testable
// without a live Firestore.
//
// No `query`: there is no Firestore analogue of the DuckDB aggregation the
// CSV store exposes. Absent `query` is a supported state — the engine-level
// fallback (`runCollectionQuery`) answers aggregations instead.

import type { CollectionItem } from "../core/schema";
import type { LoadedCollection } from "./discoveredCollection";
import { firestoreHandle, publishCollectionChange, type FirestoreHandle } from "./host";
import type { DeleteItemResult, IoOptions, WriteItemResult } from "./io";
import { safeRecordId } from "./paths";
import { projectItemFields, type ListOptions, type ListPage, type WriteOptions } from "./storePage";
import type { CollectionStore } from "./store";

/** What every operation throws when there is no live session. Worded as an
 *  instruction because it surfaces straight to the user and the agent. */
const NOT_CONNECTED =
  "firestore collection unavailable: connect remote-host first — these records live in your Firestore account, not in the workspace, so nothing can be read or written while the session is closed";

/** The records subcollection for one collection, inside the signed-in
 *  user's own subtree (the one the deployed rules cover). */
export function firestoreItemsPath(uid: string, slug: string): string {
  return `users/${uid}/collections/${slug}/items`;
}

function requireHandle(): FirestoreHandle {
  const handle = firestoreHandle();
  if (handle === null) throw new Error(NOT_CONNECTED);
  return handle;
}

/** A stored document's payload → a record. A document written by hand (or
 *  by an older version) can hold anything, so a non-object is dropped
 *  rather than surfaced as a broken record — the same fail-soft the file
 *  store applies to an unparseable `.json`. */
function toItem(data: unknown): CollectionItem | null {
  return data !== null && typeof data === "object" && !Array.isArray(data) ? (data as CollectionItem) : null;
}

/** Record ids are validated with the SAME helper every other backend uses.
 *  Firestore would accept ids the file store refuses, but a record should
 *  stay portable between backends — and an id that can't round-trip to a
 *  filename would break an export back to a file collection. */
function withSafeId<T>(itemId: string, onInvalid: () => T, run: (safeId: string, handle: FirestoreHandle) => T): T {
  const safeId = safeRecordId(itemId);
  if (safeId === null) return onInvalid();
  return run(safeId, requireHandle());
}

async function firestoreList(slug: string): Promise<CollectionItem[]> {
  const { docs, uid } = requireHandle();
  const entries = await docs.list(firestoreItemsPath(uid, slug));
  return entries.map((entry) => toItem(entry.data)).filter((item): item is CollectionItem => item !== null);
}

/** Paging is emulated over a full ordered read rather than pushed into
 *  Firestore: `offset` has no server-side form there (the cursor API needs
 *  the preceding document, which a stateless offset/limit call doesn't
 *  have), and `total` needs the full count anyway. Hence
 *  `nativePaging: false` — the capability is honest about the cost. */
async function firestorePage(slug: string, primaryKey: string, opts: ListOptions): Promise<ListPage> {
  const items = await firestoreList(slug);
  const offset = Math.max(0, opts.offset ?? 0);
  const sliced = opts.limit === undefined ? items.slice(offset) : items.slice(offset, offset + Math.max(0, opts.limit));
  return { items: projectItemFields(sliced, opts.fields, primaryKey), total: items.length, truncated: false };
}

async function firestoreRead(slug: string, itemId: string): Promise<CollectionItem | null> {
  return withSafeId(
    itemId,
    () => Promise.resolve(null),
    async (safeId, { docs, uid }) => toItem(await docs.get(firestoreItemsPath(uid, slug), safeId)),
  );
}

async function firestoreWrite(slug: string, itemId: string, item: CollectionItem, opts: IoOptions & WriteOptions): Promise<WriteItemResult> {
  return withSafeId<Promise<WriteItemResult>>(
    itemId,
    () => Promise.resolve({ kind: "invalid-id", itemId }),
    async (safeId, { docs, uid }) => {
      const collectionPath = firestoreItemsPath(uid, slug);
      if (opts.refuseOverwrite) {
        const created = await docs.create(collectionPath, safeId, item);
        if (!created) return { kind: "conflict", itemId: safeId };
      } else {
        await docs.set(collectionPath, safeId, item);
      }
      if (opts.slug) publishCollectionChange({ slug: opts.slug, ids: [safeId], op: "upsert" });
      return { kind: "ok", itemId: safeId, item };
    },
  );
}

async function firestoreDelete(slug: string, itemId: string, opts: IoOptions): Promise<DeleteItemResult> {
  return withSafeId<Promise<DeleteItemResult>>(
    itemId,
    () => Promise.resolve({ kind: "invalid-id", itemId }),
    async (safeId, { docs, uid }) => {
      const removed = await docs.delete(firestoreItemsPath(uid, slug), safeId);
      if (!removed) return { kind: "not-found", itemId: safeId };
      if (opts.slug) publishCollectionChange({ slug: opts.slug, ids: [safeId], op: "delete" });
      return { kind: "ok", itemId: safeId };
    },
  );
}

/** The store factory registered for `storage.type === "firestore"`.
 *  Synchronous and connection-agnostic by contract — see the header. */
export function firestoreStoreFor(collection: LoadedCollection, opts: IoOptions): CollectionStore {
  const { slug } = collection;
  const key = collection.schema.primaryKey;
  const ioOpts: IoOptions = { ...opts, slug: opts.slug ?? slug };
  return {
    capabilities: { writable: true, nativeQuery: false, nativePaging: false },
    list: () => firestoreList(slug),
    page: (pageOpts = {}) => firestorePage(slug, key, pageOpts),
    read: (itemId: string) => firestoreRead(slug, itemId),
    write: (itemId: string, item: CollectionItem, writeOpts: WriteOptions = {}) =>
      firestoreWrite(slug, itemId, item, { ...ioOpts, refuseOverwrite: writeOpts.refuseOverwrite }),
    delete: (itemId: string) => firestoreDelete(slug, itemId, ioOpts),
  };
}
