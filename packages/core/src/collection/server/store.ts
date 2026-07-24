// Storage abstraction over a collection's records — the one seam where
// "where do the rows come from" is decided. Implementations, selected by
// the schema's storage kind (`storageKindFor`) through the factory
// registry below:
//
//   - file store ("file"): the classic `<dataDir>/<itemId>.json` records
//     (io.ts), writable through the governed write paths;
//   - CSV store ("csv", csvStore.ts): the rows of an external `dataSource`
//     file, queried through DuckDB — READ-ONLY by definition;
//   - SQLite store ("sqlite", sqliteStore.ts): records in a single
//     node:sqlite database file — writable, native paging.
//
// Reads AND writes go through `storeFor(...)`. Writability is encoded by
// PRESENCE: `write`/`delete` exist only on writable stores, so "write
// through a read-only store" is a type error, not a runtime surprise —
// entry points refuse with `readOnlyRefusal` when the methods are absent.
// (`io.ts#writeItem`/`deleteItem` remain the file-store implementation and
// the change-event choke point; only callers WITHOUT a `LoadedCollection`
// in hand — e.g. `spawn.ts` — still call them directly.)
//
// BACKWARD COMPATIBILITY — read before evolving this interface.
// This store is INTERNAL and may change shape, but two user-facing
// contracts built on top of it are effectively FROZEN, because they are
// consumed by LLM-authored custom-view HTML files that already live in
// users' workspaces (`data/skills/*/views/*.html`, `feeds/*/views/*.html`).
// Those files cannot be migrated centrally — there is no registry of them,
// and users expect a view authored months ago to keep working:
//
//   - the desktop view-data HTTP surface (`server/api/routes/collections.ts`:
//     GET `?fields=`/`?ids=`, PUT items, POST /query, POST /actions/<id>,
//     response shapes, error semantics) as documented in
//     `packages/core/assets/helps/custom-view.md`;
//   - the remote-view bridge (`../../remote-view/index.ts`: `__MC_VIEW`
//     protocol, `getItems` page shape `{ items, total, offset, limit }`,
//     mutate replies) as documented in
//     `packages/core/assets/helps/custom-view-remote.md`.
//
// Any storage-virtualization work (new backends, paging, capability
// changes) must be invisible at those two surfaces: evolve them by
// ADDITIVE, backward-compatible supersets only — never rename/repurpose
// params or message types, never change existing response shapes, never
// let a new backend alter what an existing view observes.

import { fieldText } from "../core/fieldText";
import type { CollectionItem, CollectionStorageKind } from "../core/schema";
import type { CollectionQuery } from "../core/queryZ";
import { isReadOnlySchema, storageKindFor } from "../core/schema";
import type { LoadedCollection } from "./discoveredCollection";
import { deleteItem, listItems, readItem, writeItem, type DeleteItemResult, type IoOptions, type WriteItemResult } from "./io";
import { csvList, csvRead, csvRunQuery } from "./csvStore";
import { sqliteStoreFor } from "./sqliteStore";
import { firestoreStoreFor } from "./firestoreStore";
import { pageFromFullRead, type ListOptions, type ListPage, type WriteOptions } from "./storePage";
import { closerFor, watchDirectory, watchSingleFile } from "./watchFs";

// The pure paging/projection primitives live in storePage.ts (so backend
// modules can share them without an import cycle); re-exported here to
// keep the public surface where it has always been.
export { pageFromFullRead, projectItemFields, type ListOptions, type ListPage, type WriteOptions } from "./storePage";

export interface CollectionStoreCapabilities {
  readonly writable: boolean;
  /** Native aggregation engine for the structured DSL (`core/queryZ.ts`).
   *  False ⇒ `query` is absent; the engine-level fallback (enrich →
   *  JSONL → DuckDB, `queryRunner.ts`) answers aggregations instead. */
  readonly nativeQuery: boolean;
  /** True when `page` resolves offset/limit inside the backend. False ⇒
   *  `page` is emulated (full read, then slice) — same result, no saving. */
  readonly nativePaging: boolean;
}

/** The storage contract every backend must satisfy (verified by the shared
 *  contract test suite, `test/workspace/collections/test_storeContract.ts`):
 *
 *  1. STABLE ORDER — `page` walks a documented deterministic order (file
 *     store: lexicographic by record id; CSV store: file row order; SQLite
 *     store: `ORDER BY id`), so `offset`-paging never skips or repeats
 *     records between calls. Sorting by arbitrary fields is NOT the
 *     store's job.
 *  2. IDS — minting/resolving record ids is the store's job (the CSV
 *     store's `id0x…` encoding stays inside it); `read` resolves every id
 *     `list`/`page` returned.
 *  3. CONTAINMENT — a store never serves data from outside the workspace;
 *     symlink/realpath defenses are each implementation's obligation
 *     (io.ts is the reference).
 *  4. HONEST AGGREGATION — `query`, when present, is computed over the
 *     WHOLE data set, never from a capped read. */
/** What a store reports when its records changed underneath it.
 *
 *  Two granularities, because backends genuinely differ: a per-record file
 *  store knows WHICH record changed, while a single-artifact backend (one
 *  CSV, one db file, one remote snapshot) only knows THAT something did.
 *  Naming the difference here is what lets the watcher react uniformly
 *  instead of branching on the backend. */
export type StoreChange = { readonly kind: "item"; readonly itemId: string } | { readonly kind: "collection" };

export type StoreChangeListener = (change: StoreChange) => void;

/** Detaches a `watch` subscription. */
export type StoreUnsubscribe = () => void;

export interface CollectionStore {
  readonly capabilities: CollectionStoreCapabilities;
  /** Every record, in the store's stable order. CSV store: capped at
   *  `MAX_CSV_ROWS` (see csvStore.ts). Prefer `page` in new code. */
  list: () => Promise<CollectionItem[]>;
  /** One page of records — offset/limit/projection over the stable order. */
  page: (opts?: ListOptions) => Promise<ListPage>;
  /** One record by id, or null when missing/invalid. */
  read: (itemId: string) => Promise<CollectionItem | null>;
  /** Aggregation over the WHOLE data set (the structured DSL,
   *  `core/queryZ.ts`) — present only on stores with a native query
   *  engine (the CSV store). Absent ⇒ use the engine-level fallback
   *  (`runCollectionQuery`), never emulate ad hoc. */
  query?: (query: CollectionQuery) => Promise<Record<string, unknown>[]>;
  /** Present ONLY when `capabilities.writable` — absence IS the read-only
   *  refusal (surface it with `readOnlyRefusal`). A successful write/delete
   *  publishes a collection-change event: the store always threads the
   *  collection's slug into the publish hook, so no writer can forget it. */
  write?: (itemId: string, item: CollectionItem, opts?: WriteOptions) => Promise<WriteItemResult>;
  delete?: (itemId: string) => Promise<DeleteItemResult>;
  /** Subscribe to changes made OUTSIDE this process — a file edited by the
   *  agent, a CSV replaced by the user, a db written by another tool.
   *
   *  Resolves to an unsubscribe function, or to `null` when the backend
   *  could not arm the watch (no inotify watches left, an unreadable
   *  directory). `null` is NOT the same as absent `watch`: absent means the
   *  backend never reports changes and the caller should settle for its
   *  periodic pass, while `null` means this attempt failed and mounting
   *  should be retried. Swallowing the difference strands a collection on
   *  stale data until the process restarts.
   *
   *  This is the store's job because only it knows where its bytes live and
   *  what its own change events look like (which paths to watch, which
   *  filenames are noise, whether an atomic replace surfaces as two events).
   *  Absorbing that noise — debouncing a replace into one report — belongs
   *  here too. What to DO about a change (reconcile bells, sweep, publish)
   *  is the watcher's policy and is deliberately NOT expressed here.
   *
   *  Absent ⇒ the backend cannot report external changes; the caller falls
   *  back to its periodic pass. */
  watch?: (onChange: StoreChangeListener) => Promise<StoreUnsubscribe | null>;
}

/** The file store's stable order: lexicographic by record id (codepoint
 *  compare — locale-independent). `listItems` returns readdir order, which
 *  is filesystem-dependent; paging needs determinism. */
function sortByRecordId(items: CollectionItem[], primaryKey: string): CollectionItem[] {
  return [...items].sort((left, right) => {
    const leftId = fieldText(left[primaryKey]);
    const rightId = fieldText(right[primaryKey]);
    if (leftId < rightId) return -1;
    return leftId > rightId ? 1 : 0; // 0 on equality — a comparator that never ties breaks sort's contract
  });
}

/** True when the collection accepts UI/tool writes. A `dataSource`
 *  collection is read-only: updates happen by editing/replacing the
 *  data file itself. Every write entry point checks this BEFORE calling
 *  `writeItem`/`deleteItem` — server-enforced, not just UI-hidden. */
export function collectionWritable(collection: Pick<LoadedCollection, "schema">): boolean {
  return !isReadOnlySchema(collection.schema);
}

/** The one-line refusal write paths surface (HTTP 405 / MCP error text). */
export function readOnlyRefusal(slug: string): string {
  return `collection '${slug}' is read-only (backed by an external dataSource) — update the data file itself instead`;
}

/** A `dataSource` store over `file` (CSV row order; DuckDB-native query).
 *  A schema whose `dataSourceFile` failed to resolve yields a read-only
 *  EMPTY store rather than falling back to the (writable) file store — a
 *  half-loaded read-only collection must never become writable. */
function csvStoreFor(collection: LoadedCollection, opts: IoOptions): CollectionStore {
  const file = collection.dataSourceFile;
  const key = collection.schema.primaryKey;
  const listAll = () => (file === undefined ? Promise.resolve({ items: [], truncated: false }) : csvList(file, key, opts.workspaceRoot));
  return {
    capabilities: { writable: false, nativeQuery: true, nativePaging: false },
    list: () => listAll().then((result) => result.items),
    page: (pageOpts = {}) => listAll().then((result) => pageFromFullRead(result.items, pageOpts, key, result.truncated)),
    read: (itemId: string) => (file === undefined ? Promise.resolve(null) : csvRead(file, key, itemId, opts.workspaceRoot)),
    query: (query: CollectionQuery) => (file === undefined ? Promise.resolve([]) : csvRunQuery(file, key, query, opts.workspaceRoot)),
    // One file holds every row, so an event can't name a record — only that
    // the set changed. `watchSingleFile` watches the parent dir (an atomic
    // replace swaps the inode) and debounces the 2-3 events a replace emits.
    ...(file === undefined
      ? {}
      : {
          watch: async (onChange) =>
            closerFor(
              await watchSingleFile(
                file,
                () => false,
                () => onChange({ kind: "collection" }),
              ),
            ),
        }),
  };
}

/** The classic file store over `<dataDir>/<itemId>.json` records. */
function fileStoreFor(collection: LoadedCollection, opts: IoOptions): CollectionStore {
  const key = collection.schema.primaryKey;
  const ioOpts: IoOptions = { ...opts, slug: opts.slug ?? collection.slug };
  return {
    capabilities: { writable: true, nativeQuery: false, nativePaging: false },
    list: () => listItems(collection.dataDir, opts),
    page: async (pageOpts = {}) => pageFromFullRead(sortByRecordId(await listItems(collection.dataDir, opts), key), pageOpts, key, false),
    read: (itemId: string) => readItem(collection.dataDir, itemId, opts),
    write: (itemId: string, item: CollectionItem, writeOpts: WriteOptions = {}) =>
      writeItem(collection.dataDir, itemId, item, { ...ioOpts, refuseOverwrite: writeOpts.refuseOverwrite }),
    delete: (itemId: string) => deleteItem(collection.dataDir, itemId, ioOpts),
    // One file per record, so an event names the record that changed —
    // reported at `item` granularity, which is what lets the watcher
    // reconcile just that record instead of the whole collection. Dot-
    // prefixed names are skipped: atomic writes, OS metadata and editor swap
    // files are not records.
    watch: async (onChange) =>
      closerFor(
        await watchDirectory(
          collection.dataDir,
          (name) => name.endsWith(".json") && !name.startsWith("."),
          (filename) => onChange(filename === null ? { kind: "collection" } : { kind: "item", itemId: filename.slice(0, -".json".length) }),
        ),
      ),
  };
}

export type CollectionStoreFactory = (collection: LoadedCollection, opts: IoOptions) => CollectionStore;

// The store factory registry (plans/done/refactor-storage-virtualization.md,
// Stage 3): schema storage kind → implementation. Factories live in CORE
// (dependency-direction rule — never plugin-registered); a new backend is
// one factory + a `StorageZ` variant + a pass of the contract test suite.
const storeFactories = new Map<CollectionStorageKind, CollectionStoreFactory>([
  ["file", fileStoreFor],
  ["csv", csvStoreFor],
  ["sqlite", sqliteStoreFor],
  ["firestore", firestoreStoreFor],
]);

/** Pick the store implementation for a discovered collection via the
 *  factory registry. An unknown kind cannot normally reach here (the
 *  schema's `StorageZ` union gates it), so the throw is a loud invariant
 *  breach, not a user-facing path. */
export function storeFor(collection: LoadedCollection, opts: IoOptions = {}): CollectionStore {
  const kind = storageKindFor(collection.schema);
  const factory = storeFactories.get(kind);
  if (!factory) throw new Error(`no store factory registered for storage kind '${kind}'`);
  return factory(collection, opts);
}
