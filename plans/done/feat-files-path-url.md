# feat: path-based URL for Files view

Tracks: #632

## Goal

Switch the Files view URL shape from query-string (`/files?path=foo/bar.md`) to path-based (`/files/foo/bar.md`). Improves bookmarkability, keeps URLs copy-pasteable, and matches file-tree semantics natively.

## Design decisions

### Why catch-all `:pathMatch(.*)*` (array repeat)

Vue Router exposes two flavors for variable-depth path params:

- `:pathMatch(.*)` — single string. `.../a/b/c` → `pathMatch: "a/b/c"`. Cleaner reads, but `router.push(..., params: { pathMatch: "a/b" })` urlencodes the slashes into `%2F`, producing `/files/a%2Fb` which breaks the intent.
- `:pathMatch(.*)*` — repeatable (array). `.../a/b/c` → `pathMatch: ["a", "b", "c"]`. Each segment is encoded individually; slashes stay as path separators. Stock pattern in Vue Router docs for unknown-depth paths.

We use the array form and join on read.

### Back-compat

Old bookmarks / pasted links / log entries that use `/files?path=foo.md` must keep working. Handle this in the existing navigation guard: if the user hits `/files` with a `?path=` query, replace-redirect to `/files/foo.md`. No history pollution (one silent step) and no separate route needed.

### Server route

`/api/files/content?path=...` and related backend endpoints stay on query-string form. This PR is a UI-only URL change. The server already sanitizes its own input; nothing needs to move.

### Characters

| Case | Handling |
|---|---|
| ASCII filename | passthrough, e.g. `/files/readme.md` |
| Multi-byte (`日本語.md`) | browser percent-encodes to UTF-8 on navigation; router decodes on read |
| Space | encoded to `%20` |
| `?` `#` `%` `+` | router encodes when param is array-form |
| Path traversal (`..`) | rejected in guard (unchanged from existing logic) |
| Filesystem `/` | impossible — POSIX/Windows forbid `/` in filenames |

## Files touched

- `src/router/index.ts` — route path, pattern `/files/:pathMatch(.*)*`
- `src/composables/useFileSelection.ts` — read/write via `route.params.pathMatch` (array join on read, array on write)
- `src/components/FilesView.vue` — watcher swapped to params
- `src/router/guards.ts` — accept `params.pathMatch` array, reject `..`; add back-compat redirect for `?path=`

## Test plan

- Unit: existing `isValidFilePath` tests still pass (function unchanged); new test for the array-join reader helper.
- Manual: open `artifacts/documents/17c48329.md`, Japanese file, space-containing file.
- Back-compat: type `/files?path=foo.md`, verify redirect to `/files/foo.md`.
- Navigation guard: `/files/../etc/passwd` → rejected, redirects to `/files`.
- `yarn typecheck`, `yarn lint`, `yarn build` clean.

## Out of scope (this PR)

- Wiki, skills, todos views with any path-like state
- Any server-side route changes
