# perf(files): async `/api/files/tree` + new lazy-expand endpoint (#200)

## Motivation

`GET /api/files/tree` (`server/routes/files.ts:335`) recursively walks the entire workspace with `fs.statSync` + `fs.readdirSync` and returns one monolithic `TreeNode` JSON. Sync I/O **blocks the event loop** during the walk — all in-flight `/api/*` requests stall. Workspaces grow unbounded under `chat/`, `searches/`, `images/`, etc., so this gets worse over time.

Issue #200's MVP: **(1) make it async** + **(2) add a lazy-expand endpoint** so the client can render top-level on load and fetch children on expand.

## Phased plan

### Phase 1 — this PR (server only)

- `buildTree` → `buildTreeAsync` using `fs.promises` (no sync calls in the hot path).
- New endpoint `GET /api/files/dir?path=<rel>` returning **shallow** listing (one directory's immediate children, no recursion).
- Existing `GET /api/files/tree` kept for backwards compatibility, now also async. No response-shape change.
- Unit tests for both paths (tmp dir fixture).

Client untouched in phase 1. The event-loop-blocking risk — the actual operational concern — is fully addressed because the walk no longer holds the thread.

### Phase 2 — follow-up PR (client)

- `FilesView.vue` switches to lazy expand: mount → fetch root via `/api/files/dir?path=` → render top-level; on expand a dir node, fetch its children via `/api/files/dir?path=<rel>`, cache.
- `TreeNode` children shape becomes `undefined | TreeNode[]` (undefined = not loaded yet).
- E2E coverage for expand/collapse + cached-children behaviour.

## Design details (phase 1)

### `buildTreeAsync`

Same traversal rules as the old sync version — identical security filters (`HIDDEN_DIRS`, `isSensitivePath`, no symlinks) and ordering (dirs before files, alphabetical within). Just swaps:

```ts
fs.statSync(absPath)   → await fsp.stat(absPath)
readDirSafe(absPath)   → await readDirSafeAsync(absPath)
statSafe(childAbs)     → await statSafeAsync(childAbs)
```

Children discovered in parallel via `Promise.all` on the mapped child-build promises. Ordering is re-applied after await because `Promise.all` preserves input order but our input is `readdir`'s raw order which may not match `stat`'s insertion.

### `GET /api/files/dir?path=<rel>`

Shallow variant — reads one directory, returns its immediate children only. Each child node has the same `TreeNode` shape minus the `children` field:

```json
{
  "name": "chat",
  "path": "chat",
  "type": "dir",
  "modifiedMs": 1712345678000,
  "children": [
    { "name": "foo.jsonl", "path": "chat/foo.jsonl", "type": "file", "size": 1234, "modifiedMs": ... },
    { "name": "bar",       "path": "chat/bar",       "type": "dir",  "modifiedMs": ... }
    // Note: no nested `children` — caller fetches those on demand.
  ]
}
```

- Empty `path` param (or missing) = workspace root.
- Uses `resolveSafe` for traversal + sensitive-file rejection (same as every other endpoint).
- Returns 404 if `path` resolves outside workspace / to a sensitive file / to a non-existent entry.
- Returns 400 if `path` resolves to a file rather than a directory.

### Backwards compatibility

`GET /api/files/tree` response shape unchanged. Client gets the same full tree, just served async. Phase 2 changes the client; phase 1 is a pure optimisation.

## Tests

`test/routes/test_filesRoute.ts` already exists — extend:

- `buildTreeAsync`: tmp dir with nested structure → assert order, hidden-dir filter, sensitive-file filter, symlink skip (all parity with existing sync tests if any)
- `/api/files/dir`: shallow listing, traversal safety (`../`), missing path → 404, file path → 400, sensitive path → 404

## Non-goals (phase 1)

- Client-side lazy expand (phase 2)
- Mtime cutoff / date windowing (#200 item 4, defer)
- Collapsing heavy directories in tree view (#200 item 3, defer)
- Streaming / paginated listing of huge directories (not needed until actually hit)

## Rollout

1. Branch `perf/files-tree-async-200` ✅
2. Plan (this file) ✅
3. Implement `buildTreeAsync` + `/api/files/dir` + tests
4. Quality gates
5. PR + follow-up issue for phase 2
