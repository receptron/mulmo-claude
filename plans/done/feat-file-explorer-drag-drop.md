# feat(files): drag & drop onto File Explorer folder rows → save to workspace

Issue: receptron/mulmoclaude#2270

## Goal

Drop OS files onto a folder row in the File Explorer and have them saved into
that workspace folder directly — no chat attachment, no agent round-trip.

## Agreed spec

| Decision | Choice |
|---|---|
| Drop target | **Per folder row** in the tree (hover highlight on the target row) |
| Name conflict | **Auto-rename** (`foo.png` → `foo (1).png`) — never overwrite |
| v1 scope | Multiple files per drop; size + type limits; upload progress |
| Out of v1 | Dropping a whole directory (`webkitGetAsEntry` recursion) |

## What already exists (reuse)

- `src/composables/useFileDropZone.ts` — hardened drop-zone composable from
  #1289/#1327/#1331: `Files`-only gating, dragenter/leave counter, and a
  window-level `preventDefault` guard so a missed drop never navigates the page
  away. Its `onFiles(files: File[])` already hands back multiple files.
- `POST /api/attachments` (`attachment.ts`) — precedent for binary upload: the
  client sends a `data:` URI, the server strips it and writes the bytes. But it
  saves to a **fixed** path (`data/attachments/YYYY/MM/<id>.<ext>`).
- `server/api/routes/files.ts` — `resolveNewFilePath()` (workspace containment)
  and the exclusive-create / 409 conflict pattern from `POST /api/files/create`.
- `FileTree.vue` — recursive node component; folder rows are
  `<button v-if="node.type === 'dir'">` with `data-testid="file-tree-dir-*"`.
  The existing `createFile` emit is the established pattern for a folder-scoped
  action bubbling from a row up to the pane.

## Gap to build

`POST /api/files/create` is **text-only** (`writeFile(abs, content: string,
{flag:"wx"})`), and the attachment route can't target a chosen folder. So we
need one new endpoint: **binary upload into a workspace-relative directory**.

## Design

### Server — `POST /api/files/upload`

Body `{ dir: string, filename: string, dataUrl: string }`.

1. Resolve `dir` through the existing workspace-containment helper; reject
   escapes (`..`, absolute, symlink-out) exactly like `files.create`.
2. Sanitize `filename` to a single path segment (no separators, no `..`).
3. Enforce **max size** and an **allow/deny type policy** (constants, not magic
   numbers) — reject oversized/blocked uploads with a clear 4xx.
4. Decode the `data:` URI (reuse `stripDataUri`).
5. Write with `flag: "wx"`; on `EEXIST` retry as `name (n).ext`, incrementing
   `n` until it lands. Bounded retry count so a pathological directory can't
   spin. Returns the final workspace-relative path.

### Frontend

- **Per-row handlers, not per-row composables.** `useFileDropZone` installs
  window listeners in `onMounted`; `FileTree.vue` is recursive (one instance per
  node), so calling it per row would attach a window listener per node. Instead:
  lightweight `@dragenter/@dragover/@dragleave/@drop` on the folder button plus a
  local `isDropTarget` ref for the highlight, and install the shared window
  default-guard **once** at the pane level.
- On drop the row emits `{ folder: node.path, files: File[] }` upward (mirrors
  the existing `createFile` emit), and the pane performs the uploads.
- Upload each file via `src/utils/api.ts` (bearer token attached), sequentially,
  surfacing progress; refresh the tree when the batch finishes.
- i18n: all 8 locales in lockstep per `docs/i18n.md` (drop hint, progress,
  size/type rejection, failure toast).

## Tests

- Server: containment escape rejected, filename sanitized, oversize rejected,
  blocked type rejected, auto-rename increments on collision, happy path writes
  the bytes.
- Frontend/e2e: dropping onto a folder row saves into that folder and the tree
  shows the new entry.

## Files changed

- `server/api/routes/files.ts` (upload handler) + `src/config/apiRoutes.ts` (route constant)
- `server/utils/files/upload-name.ts` (filename rules) + `server/utils/files/upload-io.ts` (exclusive create)
- `src/components/FileTree.vue`, `src/components/FileTreePane.vue`, `src/components/FilesView.vue`
- `src/composables/useFileDropZone.ts` (shared window guard + drag-end pulse)
- `src/lang/*.ts` (8 locales)
- `test/utils/test_upload_name.ts`, `test/api/routes/test_filesUpload.ts`
- `docs/shared-utils.md` (helper catalog entries)
