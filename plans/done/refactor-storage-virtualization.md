# Collection storage virtualization — Stage 0–1

**Status**: Stages 0–4 + post-merge follow-up done (Stage 1 in REVISED additive form — see
"Stage 1 revision"; Stage 2–4 notes below)
**Owner**: TBD
**Last updated**: 2026-07-19

Prepare the collection engine for multiple storage backends by promoting the
existing `CollectionStore` seam (`packages/core/src/collection/server/store.ts`)
from a read-only convenience into the one boundary where "where do the rows
come from" is decided. No new backend is added in these stages — the two
existing implementations (per-record JSON file store, CSV/DuckDB `dataSource`
store) stay as they are; what changes is that the four concerns currently
leaking around the seam (write, query, paging, change events) get folded in,
stage by stage.

## Hard constraint — existing custom views must keep working

LLM-authored custom-view HTML files already persist in users' workspaces
(`data/skills/*/views/*.html`, `feeds/*/views/*.html`) and cannot be migrated
centrally. Two user-facing contracts are therefore FROZEN and every stage must
be invisible at these surfaces (source comments marking them:
`store.ts` header, the view-data section of `server/api/routes/collections.ts`,
and the `packages/core/src/remote-view/index.ts` header):

- **Desktop view-data HTTP contract** (`custom-view.md`): `?fields=` / `?ids=`
  semantics, `{ collection, count, items }` / `{ written, rejected }` /
  `{ rows }` shapes, status-code semantics (400 + `{ error }`, 403
  mutate-kind, 409 require-gate). Evolve by ADDITION only.
- **Remote-view bridge** (`custom-view-remote.md`): `__MC_VIEW` protocol, the
  `getItems` page shape `{ items, total, offset, limit }`, mutate replies.
  Evolve only by backward-compatible supersets + `REMOTE_VIEW_PROTOCOL` bump
  (the way v2 added the mutate pair).

## Current state (2026-07-19)

- `CollectionStore` = `{ capabilities: { writable }, list(), read(id), query?() }`,
  two impls picked by `storeFor` (`isReadOnlySchema` ⇒ CSV store).
- Writes bypass the store: `io.ts` `writeItem` / `deleteItem` called directly,
  guarded per-call-site by `collectionWritable`.
- Aggregation: native `query` on the CSV store only; file-backed collections
  aggregate via `manageTool.ts` special wiring (enrich → temp JSONL → DuckDB,
  `jsonlQuery.ts`) — placed there, not in `store.ts`, to avoid an import cycle
  with `derive.ts`.
- `list()` materializes everything; CSV capped at `MAX_CSV_ROWS` (5000) with a
  silent warn. Remote view re-paginates in memory.
- Change events (`publishCollectionChange`) are embedded in file-store writes.

## Stage 0 — route every read through `storeFor`

Pure refactor, behavior unchanged, no core API change (no version bump).

1. `server/remoteHost/handlers/getFeed.ts` — replace the direct
   `listItems(feed.dataDir)` with a `storeFor`-based `listRecords` injection,
   same shape as `getCollection.ts:33` already uses.
2. `server/workspace/collections/index.ts` — stop re-exporting the raw io
   readers; migrate its own direct read call sites to `storeFor`.
3. `server/workspace/collections/remoteView.ts` — the mutate path's existence
   check (`readItem`) moves to `store.read`. (`writeItem` / `deleteItem` stay
   direct until Stage 2.)
4. Enforcement: ESLint `no-restricted-imports` forbidding the read exports of
   `collection/server/io` outside `packages/core/src/collection/` (+ one line
   in `docs/lint-policy.md`).

## Stage 1 revision (what actually shipped)

The original Stage 1 below proposed a BREAKING `list()` → `ListPage` change.
Implemented instead as an **additive** change, for two reasons:

1. **0.x caret ranges.** Core is 0.25.x and every dependent
   (collection-plugin, google-plugin, launcher, MulmoTerminal) pins
   `^0.25.x`, which a 0.26.0 minor cannot satisfy — a breaking change forces
   a plugin range ratchet + publish cascade + a synchronized MulmoTerminal
   port. Additive ⇒ core 0.25.1 (patch), no ratchet, nothing breaks.
2. **Existing custom views must keep working** (explicit requirement).
   `list()` semantics stay byte-identical for every current consumer.

Shipped shape: `list()` unchanged; NEW `page(opts?) → ListPage`;
`capabilities` grew `nativeQuery` / `nativePaging`; `queryRunner.ts`
(`runCollectionQuery`) unifies native vs enrich+JSONL aggregation — the
manageCollection `queryItems` AND (transitively — the view `/query` route
reuses that handler) the desktop custom-view query surface now share it with
identical outputs. Contract tests: `test/workspace/collections/test_storeContract.ts`.

**Deliberately deferred:**
- `readPage.ts` and the remote-view rewire onto `page()`. The file store's
  `page()` order is sorted-by-record-id (paging needs determinism), while
  `remoteViewItems` today serves `list()`'s readdir order — switching would
  change the order existing remote views observe. Adopt `page()` there only
  as a deliberate, tested decision (it FIXES latent "Load more"
  skip/duplicate bugs, but it is an observable change on a frozen surface).
- Sort pushdown, `list()` deprecation → fold into the next breaking wave
  (Stage 2's write fold-in), so dependents ratchet once, not twice.

## Stage 1 — widen the interface (same two stores) — ORIGINAL DESIGN

(Kept for reference; superseded by the revision above where they differ.)

Breaking change to core's exported types ⇒ minor bump of `@mulmoclaude/core`
in the same PR (+ launcher range lockstep), and a matching port in
MulmoTerminal's `server/backends` (a dep bump alone leaves dataSource
collections unopenable — see the engine-contract-port rule).

### 1-1. `CollectionStore` v2

```ts
export interface CollectionStoreCapabilities {
  readonly writable: boolean;
  readonly nativeQuery: boolean;  // false ⇒ engine-level fallback handles query
  readonly nativePaging: boolean; // false ⇒ list(opts) emulated by full read + slice
}

export interface ListOptions {
  offset?: number;                 // 0-based, over the store's stable order
  limit?: number;                  // absent = all (subject to store cap)
  fields?: readonly string[];      // STORED fields only (+ primaryKey, always)
}

export interface ListPage {
  items: CollectionItem[];
  total: number;                   // pre-paging count; lower bound when truncated
  truncated: boolean;              // store capped the scan (e.g. MAX_CSV_ROWS)
}

export interface CollectionStore {
  readonly capabilities: CollectionStoreCapabilities;
  list: (opts?: ListOptions) => Promise<ListPage>;
  read: (itemId: string) => Promise<CollectionItem | null>;
  query?: (query: CollectionQuery) => Promise<Record<string, unknown>[]>; // iff nativeQuery
}
```

Contract invariants (doc-comment on the interface; a new backend joins by
satisfying these + the contract test suite):

1. **Stable order** — `list` returns a documented deterministic order (file
   store: lexicographic by record id; CSV store: file row order). Sorting is
   NOT the store's job.
2. **Id minting/resolution is the store's job** (`id0x…` encoding stays inside
   the CSV store); `read(id)` resolves every id `list` returned.
3. **Never serve data outside the workspace** — symlink / containment defenses
   are each implementation's obligation (file store is the reference).
4. **`query` is correct over the WHOLE data set** — never computed from a
   capped `list`.

### 1-2. Engine-level helpers (above the store, below consumers)

- `readPage.ts` — `readPage(collection, { offset, limit, fields, sort })`:
  pushes down to `store.list(opts)` when possible (no sort, all-stored fields,
  `nativePaging`); otherwise full read → `enrichItems` → sort → slice →
  project. Rule: any computed field in `fields` ⇒ full-read path (no formula
  dependency analysis — big data goes through native `query` instead).
- `queryRunner.ts` — `runCollectionQuery(collection, query, opts)`: native
  `store.query` when present, else enrich + `runQueryOverRows`. Replaces the
  special wiring in `manageTool.ts#handleQueryItems` and backs the view-data
  `/query` route. Lives at the derive layer, so the old jsonlQuery/derive
  import-cycle concern disappears.

### 1-3. Caller migration

`list()` returning `ListPage` instead of `CollectionItem[]` is the one
breaking change; ~10 call sites become `(await store.list()).items`
mechanically. `ontology.ts` record count becomes
`(await store.list({ limit: 0 })).total` (drops a full materialization).

### 1-4. Store contract tests

One shared suite (`storeContract.test.ts`) run against both implementations:
stable order, offset/limit boundaries, `fields` projection + primaryKey
guarantee, `truncated` behavior, `read(list-id)` round-trip, `query` presence
matching `capabilities`. This is what makes a future third backend cheap.

### PR slicing

- **PR-A (Stage 0)**: call-site consolidation + ESLint rule. Behavior
  unchanged.
- **PR-B**: `ListPage` / `ListOptions` + both store impls + contract tests +
  mechanical caller migration + core minor bump.
- **PR-C**: `readPage` / `queryRunner`; move manageTool, routes, remoteView
  onto them (remote view's in-memory paging replaced by `readPage`).

## Stage 2 — writes into the store (done)

Shipped as designed, with two deviations from the sketch:

- **Presence encodes writability**: `write?(itemId, item, { refuseOverwrite? })`
  / `delete?(itemId)` exist only on writable stores; every entry point's guard
  became "method absent ⇒ `readOnlyRefusal`" with its refusal text unchanged
  (manageCollection putItems, HTTP POST/PUT/DELETE 405s, remote-view
  `read-only-collection`).
- **`publishCollectionChange` did NOT move out of io.ts** (deviation): io's
  write/delete remain the event choke point so no transitional direct caller
  can lose events; the store instead ALWAYS threads `collection.slug` into the
  publish hook, so store-mediated writers can't forget it.
- **Still on raw io by design**: `spawn.ts#maybeSpawnSuccessor` (its signature
  carries slug/schema/dataDir, not a `LoadedCollection`) — fold it in whenever
  its signature is next touched. Everything else (manageTool, mutate actions,
  feeds upsert+prune, google calendar sync, HTTP routes, remote-view mutate)
  goes through the store; the ESLint restriction now covers
  `writeItem`/`deleteItem` too.
- Contract tests grew write/delete presence + round-trip (conflict on
  create-overwrite, delete → not-found) assertions.

## Stage 3 — explicit storage + factory registry (done)

- Schema: new `storage` block (`StorageZ`, v1 union: `{ type: "sqlite", path }`),
  exactly-one-of `dataPath` | `dataSource` | `storage`. Derived
  `storageKindFor(schema)` → `"file" | "csv" | "sqlite"` — existing schemas
  carry no `storage` key and resolve exactly as before.
- Discovery: `storage.path` gets the same containment resolution as
  `dataSource.path` → `LoadedCollection.storageFile`, plus the conventional
  phantom `dataDir`.
- `storeFor` resolves through a factory registry
  (`Map<CollectionStorageKind, CollectionStoreFactory>`) — factories live in
  core only (dependency-direction rule; no plugin registration). Pure paging
  helpers moved to `storePage.ts` so backend modules share them without an
  import cycle (store.ts re-exports — public surface unchanged).

## Stage 4 — sqlite backend (done)

`sqliteStore.ts`: one db file, one `records(id TEXT PRIMARY KEY, record TEXT)`
table, JSON per row. Passes the full contract suite unchanged — which was the
point.

- **Engine: `node:sqlite`** (no native npm dep). Engines floor is Node >=
  20.12 but node:sqlite needs >= 22.5 ⇒ lazy import, DuckDB-style degradation
  (only sqlite collections break, clear error;
  `assets/helps/error-recovery.md` has the section).
- `nativePaging: true` (LIMIT/OFFSET + COUNT(*)); order `ORDER BY id`
  (BINARY = the file store's documented lexicographic order);
  `nativeQuery: false` — aggregation flows through `runCollectionQuery`'s
  enrich+JSONL fallback, exercising it on a non-file backend.
- Same `safeRecordId` id rule as the file store (ids portable across
  backends; remote-view preflights keep holding); symlinked db refused
  (io.ts parity); write publishes its own `publishCollectionChange` (io.ts
  is not in the path here).
- **Known v1 gaps** (documented in error-recovery.md +
  collection-skills.md): `spawn`, `completionField`, and `triggerField`
  schema-rejected (spawn writes raw record files; the collection watcher's
  reconcilers scan the dataDir's .json files — PR #2203 review finding);
  record Repair/validation scans record FILES so it sees no sqlite records
  (no false errors, just no repair); `deleteCollection` archives skill +
  phantom dataDir but leaves the `.db` file; external edits to the db
  don't fire change events (no watcher).

## Post-merge follow-up (PR #2203 review + web-test findings) — done

- **Watcher/reconciler are store-aware**: `maybeSpawnSuccessor`,
  `reconcileItem`, `reconcileAllItems`, and the sweep all take a
  `LoadedCollection` and go through `storeFor` — the schema-level rejection
  of `spawn` / `completionField` / `triggerField` on `storage` collections
  is LIFTED. A db-file watcher (parent-dir mount, sqlite sidecars
  included, per-slug single-flight) drives full-pass reconciliation +
  change publishes for external db edits. (Signature change — MulmoTerminal
  needs the matching port when it ratchets to 0.25.1.)
- **`deleteCollection`** archives the `.db` beside the skill and removes
  the live file (+`-wal`/`-journal`/`-shm`); `dataSourceFile` stays
  untouched (user-owned).
- **Repair/validation** lists non-file backends through the store and
  lints with the same strict tier (issues keyed by record id).
- **Desktop custom-view images**: new `GET view-data/image?path=…&maxEdge=…`
  (read capability) resolves a CURRENT image-field value into a thumbnail
  `{ dataUrl }` — the desktop sibling of remote `imageFields`; authorization
  set = the records' image-field values, nothing else. Documented in
  custom-view.md "Displaying images" (born from the NPB web test, where the
  agent base64-embedded logos into the view HTML for lack of this).

## Later stages (sketch, not in scope here)

- `nativeSort` capability + sort pushdown (design against a second
  SQL-capable backend) and `list()` deprecation — the next BREAKING wave,
  bundled so dependents ratchet once.

## Open questions

1. Keep "`list()` with no opts = everything (honest `truncated`)" vs a separate
   explicit `readAll` method. Current plan: the former.
2. Sort pushdown timing — deferred to Stage 4 (design against a real backend).
3. Feeds: file-store-only code (`feeds/server/engine.ts` direct `deleteItem`)
   is Stage 2 scope; Stage 0–1 aligns reads only.
