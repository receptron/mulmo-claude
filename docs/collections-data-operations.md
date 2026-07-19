# Collection data operations — who reads, who writes, through what

How collection **records** are stored and mutated today, and which layers bypass which
abstractions. Companion to two existing docs that deliberately do *not* cover this:

- [`papers/collections-architecture.md`](papers/collections-architecture.md) — the *concept*
  (`schema.json` as a DSL defining a whole app).
- [`collection-registries.md`](collection-registries.md) — *distribution* (Discover / Contribute).

This one is the plumbing.

## Storage model

A collection is a **skill directory shipping `schema.json` next to `SKILL.md`**. Records are
**one JSON object per file**:

```
<dataDir>/<itemId>.json
```

The record id **is the filename stem** (`packages/core/src/collection/server/paths.ts:119-121`).
That equivalence is load-bearing — ids are constrained by filesystem-safety regexes
(`safeRecordId`, `paths.ts:32-39`), and the CSV backend hex-encodes its keys to survive it
(`csvStore.ts:53-56`).

Three discovery roots, precedence **project > user > feed**
(`server/discovery.ts:194-228`):

| Root | Path |
| --- | --- |
| project | `<workspace>/.claude/skills/<slug>/` |
| user | `~/.claude/skills/<slug>/` |
| feed | `<workspace>/feeds/<slug>/` |

Records live at `schema.dataPath` (e.g. `data/todos/items/`, or
`data/collections/<slug>/items` for registry imports). The canonical skill source is
`data/skills/<slug>/`, mirrored into `.claude/skills/<slug>/` by a hook.

### Backends

Per-collection backend selection is an established pattern — a schema declares exactly one
of `dataPath` / `dataSource` / `storage`, and `storeFor` resolves the implementation from a
factory registry keyed by `storageKindFor(schema)`.

| kind | declared by | records live in | writable |
| --- | --- | --- | --- |
| `file` | `dataPath` (the default) | `<dataDir>/<id>.json`, one per record | yes |
| `csv` | `dataSource` | an external CSV, queried through DuckDB | **no** |
| `sqlite` | `storage: { type: "sqlite", path }` | one SQLite db file in the workspace | yes |
| `firestore` | `storage: { type: "firestore" }` | the user's Firestore, `users/{uid}/collections/{slug}/items` | yes |

A `dataSource` collection is additionally barred from `singleton` / `ingest` / `spawn` /
`mutate` actions because those all write. The `firestore` variant takes no path — its
location is derived from the session's uid, so a schema can't point records outside the
subtree the deployed security rules cover — and it is readable/writable only while a
remote-host session is open (every operation fails loudly otherwise, never returning an
empty result).

## The read seam: `storeFor()`

`storeFor(collection)` (`server/store.ts:26-37`) is a genuine chokepoint:

```ts
interface CollectionStore {
  readonly capabilities: { readonly writable: boolean };
  list: () => Promise<CollectionItem[]>;
  read: (itemId: string) => Promise<CollectionItem | null>;
  query?: (query: CollectionQuery) => Promise<Record<string, unknown>[]>;
}
```

`query` is optional by design: absent ⇒ the collection has no native query engine, and
**callers surface a clear error rather than emulating it** (`store.ts:33-36`).

Every display path routes through it — `routes/collections.ts:191,475,527,983`,
`manageTool.ts:163,308`, `derive.ts:64`, `ontology.ts:92`, `dynamicIcon.ts:46`,
`getCollection.ts:33`, `remoteView.ts:299`.

## The write path: deliberately *not* through the store

`store.ts:9-13` says so outright:

> write paths keep calling `writeItem`/`deleteItem` directly but MUST refuse read-only
> collections first (`collectionWritable`) — the store deliberately exposes no write methods,
> so a "write through the store" can't be authored by accident.

Writers call `io.ts` free functions with a `dataDir` **string**:

| Writer | Call site |
| --- | --- |
| HTTP POST/PUT/DELETE | `server/api/routes/collections.ts:265,310,341` |
| Agent `putItems` | `manageTool.ts:244,280` |
| `mutate` actions | `mutate.ts:69,91` |
| `spawn` successors | `spawn.ts:235` |
| Feed ingest | `feeds/server/engine.ts:38,82` |
| Remote / mobile views | `remoteView.ts:143,171,174` |
| Watcher reconcile | `reconciler.ts:226,274,312` |

One module (`io.ts`), but **not one interface** — the caller resolves the path, so signatures
are `(dataDir, itemId)` rather than `(collection, itemId)`.

Three readers skip `io.ts` entirely and hit `fs` on record files directly:
`validate.ts:9,45-52` (`readdir` + `readFile`), `ontology.ts:10` (`readdir` count),
`delete.ts:20` (`cp` / `rm` over `dataDir`).

### Filesystem semantics baked into the write API

- Create-vs-update is expressed as `O_EXCL` `open(path,"wx")` vs `writeFileAtomic`
  (`io.ts:173-189`).
- Result kinds leak fs concepts into HTTP status mapping: `"path-escape"`, `"invalid-id"`,
  `"conflict"` (`io.ts:132-136`).
- `writeFileAtomic` is a local write-tmp + `rename(2)` (`atomic.ts:44-55`), update path only.
- Containment checks call `realpathSync` on **every** read and write (`paths.ts:50,75`) — the
  only synchronous fs in the hot path.
- `listItems` is a full `readdir` scan with no pagination, filter, or ordering
  (`io.ts:78-98`).

Everything else (`list` / `read` / `write` / `delete`) is already `async`.

## The agent path: files are the interface

`manageCollection` is the only collection MCP tool (`toolNames.ts:67`,
`mcp-tools/index.ts:39`). Its actions:

```
getItems | putItems | deleteItems | queryItems | getOntology | schemaDocs | getSchema | putSchema
```

`deleteItems` (#2194) closed the one gap where the tool had no equivalent at all: deleting a
record used to mean unlinking the file, which a non-file backend cannot offer. A missing id
comes back in `rejected` rather than counted as deleted, so a typo can't be reported as done.

Raw file I/O nonetheless remains a documented, supported escape hatch, not an accident:

> Read / Write / Edit on the record files stays available (**files are the source of truth**)
> — `packages/core/assets/helps/collection-skills.md:918-919`

> Collections are workspace data every role can already reach via raw Read/Write/Edit
> — `manageTool.ts:570-573`

And the watcher design assumes direct file writes are the *dominant* path:

> the canonical pattern for collection-skills has the agent **Write records directly with the
> Write tool** — that path never hits the REST API, so a route-level hook would miss **most of
> the traffic the user generates**.
> — `packages/core/src/collection-watchers/watcher.ts:7-11`

`manageCollection` is *preferred* (`manageTool.ts:476`) mainly because `getItems` returns
computed values — derived formulas, toggles, embeds — that the stored JSON does not contain.

## Change events → UI

The event contract is clean and **backend-agnostic** — slug + ids + op, no paths, no bodies:

```ts
publishCollectionChange({ slug, ids, op })   // op: "upsert" | "delete"
```

Fired from `io.ts:192` (upsert) and `io.ts:210` (delete). Bridged onto WebSocket pub/sub by
`server/events/collection-change.ts:45-64`, on channel `` `collection:${slug}` ``
(`src/config/pubsubChannels.ts:74-86`). `CollectionView.vue` / `CollectionCustomView.vue`
subscribe via `composables/collections/uiHost.ts:188` and **refetch** — the payload carries no
record bodies, so it is a refresh ping, safe to relay.

Publication is fire-and-forget: a failed publish is logged and swallowed, because dropping one
live refresh beats crashing the write that triggered it (`collection-change.ts:56-64`).

### The fs watcher is a separate producer

`collection-watchers` runs `fs.watch` per `dataDir` (`watcher.ts:347-352`), plus 30s
rediscovery (`watcher.ts:32`) and a 60s clock tick (`watcher.ts:40`). Its `onEvent`
(`watcher.ts:410-430`) drives **only the completion-bell reconciler**. It does **not** call
`publishCollectionChange` for file-backed collections — only the `dataSource` watcher publishes
(`watcher.ts:305`).

> **Known gap.** When the agent Writes a record file directly — the path the architecture calls
> canonical — the completion bell updates but open views get **no live-refresh event**. Live
> updates only fire for writes that went through `io.ts` with a `slug` in `opts`.

## Summary — which layer does what

| Layer | Reads via | Writes via |
| --- | --- | --- |
| Frontend (`src/`) | HTTP `/api/collections` → `storeFor` | HTTP POST/PUT/DELETE → `io.ts` |
| Agent | `manageCollection` **or** raw Read | `manageCollection.putItems` / `deleteItems` **or** raw Write / unlink |
| Server internals | `storeFor` | `io.ts` free functions, path-keyed |
| Feeds / spawn / mutate | `storeFor` | `io.ts` free functions |

The asymmetry is the thing to remember: **reads are abstracted, writes are not, and the agent
is outside both by design.**

## Consequences for adding a non-file backend

A backend without files (a remote DB, a hosted store) would need, in rough order:

1. ~~**A delete action on `manageCollection`.**~~ Done in #2194 — `deleteItems`. Without it the
   agent had no way to delete a record on a backend with no file to unlink.
2. **A per-backend rule for raw file I/O**, since "files are the source of truth" stops being
   true — this is a change to documented agent behaviour, not just to code.
3. **Writes keyed by collection, not by `dataDir` path** — roughly 10 call sites, all async,
   all funnelling into 3 functions.
4. **`publishCollectionChange` lifted out of `io.ts`** into whatever wrapper both backends
   share, so events fire identically.
5. **A backend branch for the fs-specific bits**: `realpathSync` containment is meaningless off
   the filesystem, and `"path-escape"` simply never occurs.

Things that stay filesystem-only regardless: `schema.json` and custom-view HTML/i18n assets
(`io.ts:250-337`) are skill *source*, not records; registry import/export writes record seeds
as files (`importWriter.ts:22`, `exportCollection.ts:10`); `deleteCollection`'s archive-then-`rm`
spans three on-disk locations (`delete.ts:161-181`).
