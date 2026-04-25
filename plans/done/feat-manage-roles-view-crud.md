# Custom Roles View — Create / Edit / Rename from UI

## Overview

The `manageRoles` plugin view (`src/plugins/manageRoles/View.vue`) previously let
the user inline-edit a limited set of fields on existing custom roles — but
creating a new role or changing a role's id was only possible by asking Claude
in chat. This change makes both operations available directly from the view.

The key user-facing additions:

1. **`+ Add` button** in the header to open a creation panel.
2. **Editable `ID` field** in the existing inline editor (ids are the filename
   of `~/mulmoclaude/config/roles/<id>.json`, so renaming must also delete the
   old file — a server change was required).
3. **Disabled-by-default submit buttons** tied to live validation (required
   id / charset / duplicate / required name).
4. **Responsive plugin-checkbox grid** using CSS `auto-fit` so the column
   count adapts to the panel width instead of being stuck at 2 columns.
5. **Scrollable body area** so the tall creation/edit panels are always
   fully reachable.
6. **Button style consistency** — the `+ Add` button matches the ToDo
   view's `+ Add` styling (`bg-blue-500 ... px-2 py-1 text-xs`, defined
   in `src/components/TodoExplorer.vue`) and sits on the right side of
   the header.

---

## Baseline drift since plan was drafted

`main` has moved forward from the branch point (`683520c`) with changes
that touch the files listed below. None of them alter logic — they
change formatting and lint posture — but they do shift what a rebase /
merge of this work will look like.

* **`.prettierrc` added** with `printWidth: 160` (`58054fb`, `579e8b7`).
  Every role-plugin file (`server/api/routes/roles.ts`,
  `server/workspace/roles.ts`, `src/config/roles.ts`,
  `src/plugins/manageRoles/{View,Preview}.vue`,
  `src/plugins/manageRoles/{definition,index}.ts`) has been reflowed —
  multi-line imports, wrapped JSX-like Vue attributes, and wrapped
  function signatures now collapse to one line where they fit. Rebasing
  the work for this plan will cascade prettier through the diff; no
  functional conflicts, just whitespace.
* **`eslint.config.mjs` — `id-length` added as `warn`** (`4c788a1`),
  `min: 3`, exceptions `i / j / fs / os`. The plan's
  `deleteRoleResult(id, sessionId)` helper uses `id` (2 chars) — that
  will surface as a lint warning. Either rename the parameter
  (e.g. `roleId`) or accept the warn; it does not block CI.
* **`eslint.config.mjs` — `sonarjs/no-nested-conditional` flipped
  `off → warn`** (`d5ddf09`). The proposed code does not use nested
  ternaries, so this should not fire.

No logic changes in any role-plugin file on `main` since plan was
drafted. All pre-change assumptions (monolithic `executeManageRoles`,
no `id` field in `EditForm`, `grid-cols-2` on the plugin checkbox grid,
no `+ Add` button) still hold on current `main`.

---

## Files changed

| File | Change |
|---|---|
| `src/plugins/manageRoles/View.vue` | Template + script: new-role panel, editable id, computed validation, scrollable body, responsive plugin grid, ToDo-style `+ Add` button |
| `server/api/routes/roles.ts` | New `oldRoleId` field on the manage payload; rename handling; refactor into `listRolesResult` / `deleteRoleResult` / `saveRoleResult` helpers to satisfy the cognitive-complexity lint threshold |
| `test/routes/test_rolesManage.ts` | New unit tests for the rename path (happy path + builtin-id guard + duplicate-id guard + plain update) |

No package changes, no schema changes to the persisted JSON files.

---

## Server change — `server/api/routes/roles.ts`

### New input field

```ts
interface ManageRolesInput {
  action: string;
  role?: { id, name, icon, prompt, availablePlugins, queries? };
  roleId?: string;
  oldRoleId?: string;   // ← new
}
```

### Rename semantics

When `action === "update"` and `oldRoleId` is present and differs from
`role.id`, the request is treated as a **rename**:

1. Reject if the new id collides with a built-in role id
   (`BUILTIN_IDS.has(role.id)`).
2. Reject if the new id is already used by another custom role
   (`roleExists(role.id)`) — this guards against silently overwriting a
   neighbour.
3. `saveRole(role.id, roleToSave)` — writes the new file.
4. `deleteRole(oldRoleId)` — removes the old file (guarded only
   against a missing file). A file at `config/roles/<builtin>.json`
   is a user-created override, not the built-in itself (which lives in
   `BUILTIN_ROLES`); leaving it behind on rename would continue to
   shadow the built-in and couldn't be cleaned up via `delete`, which
   also rejects built-in ids.

Old `update` requests without `oldRoleId` keep their previous behaviour
(overwrite in place), so existing LLM tool-calls are unaffected.

### Refactor

The original `executeManageRoles` was a single function containing the
list, delete, and create/update branches. Adding the rename check pushed
it over the `sonarjs/cognitive-complexity` threshold (15), so it was
split:

```
executeManageRoles(input, sessionId)  // tiny dispatcher
  ├── listRolesResult()
  ├── deleteRoleResult(id, sessionId)
  └── saveRoleResult(input, sessionId)
        └── validateSaveInput(input)  // returns {role, isRename} | errorString
```

---

## Client change — `src/plugins/manageRoles/View.vue`

### Template additions

```
┌─ Header ──────────────────────────────────────────┐
│ Custom Roles              N roles  [+ Add]        │   ← ToDo-style button
└───────────────────────────────────────────────────┘
┌─ flex-1 overflow-y-auto ──────────────────────────┐
│ ┌─ creating === true ─ Create new role ─────────┐ │
│ │ [ID] [Name] [Icon]                            │ │
│ │ [Prompt textarea]                             │ │
│ │ [Plugins — auto-fit grid]                     │ │
│ │ [Starter queries]                             │ │
│ │ [Create (disabled if invalid)] [Cancel]       │ │
│ │ validation hint (gray) / server error (red)   │ │
│ └───────────────────────────────────────────────┘ │
│ <role list>                                       │
│   └─ inline editor now has an editable [ID] too   │
└───────────────────────────────────────────────────┘
```

Both the creation panel and the inline editor now share a single
`flex-1 overflow-y-auto` scroll container; previously the creation
panel was a direct flex child with no overflow handling, so tall
content clipped the Create/Cancel buttons.

The plugin checkbox grid in both panels uses:

```
grid gap-x-4 gap-y-1 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]
```

so column count adapts to the actual panel width instead of a fixed
`grid-cols-2`.

### Script additions

* `EditForm` now has an `id` field. `NewRoleForm` was removed because
  it became identical to `EditForm`.
* `creating` / `newForm` / `createError` state for the creation panel;
  `startCreate` / `cancelCreate` toggle it and reset the form.
* `validateRoleForm(form, excludeId)` — shared validator. `newFormError`
  calls it with `excludeId = null`; `editFormError` passes
  `selectedId.value` so the currently-edited role does not count as a
  duplicate of itself.
* Both submit buttons bind `:disabled="saving || !!formError"` with
  `:title="formError ?? ''"` so hover reveals *why* it is disabled, and
  a gray hint line below the buttons shows the active validation error.
* `saveEdit(originalId)` sends `{ action: "update", role, oldRoleId:
  originalId }` — `originalId` is the template `role.id` from the v-for,
  which always reflects the id that existed before the edit session.
* `saveNew()` sends `{ action: "create", role }` and then calls the
  existing `refreshList()` helper, which emits the `updateResult`
  event and calls `appApi.refreshRoles()` so the top-bar role dropdown
  reflects the new role immediately.

### Validation rules (client-side, mirrored on server)

1. id required
2. id matches `/^[a-zA-Z0-9_-]+$/`
3. name required
4. id not already used by another custom role (excluding self on edit)

Server adds: id not a built-in id, and on rename, id not already used
(in case the client is out of sync).

---

## Tests — `test/routes/test_rolesManage.ts`

Four unit tests exercise `executeManageRoles` against a temp workspace
(HOME override + dynamic import, matching `test_html_io.ts`):

1. **rename happy path** — new file exists, old file is gone.
2. **rename into built-in id** — rejected, no file written.
3. **rename into an id already used** — rejected, both original roles
   intact.
4. **plain update (no `oldRoleId`)** — still works, nothing deleted.

---

## Out of scope / follow-ups

* No refactor of the creation panel and inline editor into a shared
  component. The markup duplication is ~80 lines; extracting a
  `<RoleEditor>` component is a plausible next step but was kept out of
  this change to keep the diff reviewable.
* No auto-slug from Name → ID. The user types the id explicitly; the
  validator gives fast feedback if they pick a bad one.
* Dev-server ergonomics: `yarn dev` runs `tsx server/index.ts` without
  `--watch`, so server-side changes in `roles.ts` require a manual
  restart of the server process. This surfaced during testing of the
  rename path. Not changed here — it is a repo-wide concern.
