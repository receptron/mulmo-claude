# feat: Writable remote custom views — phase 4: update / delete from the phone

## Goal

Phases 2–3 made the mobile remote (`mulmoserver`) **read** collections: the
default `CollectionCardList` (phase 2) and per-collection LLM-authored mobile
HTML views (phase 3, `plans/done/feat-remote-custom-view.md`). Both are strictly
read-only — the phase-3 remote-view contract exposes only `getItems`,
`startChat`, and `t`.

This phase makes a remote view **writable**: a `target: "mobile"` view can
**toggle a field** (check/uncheck a todo) and **delete a record**, directly —
not by opening a chat draft. It extends the same postMessage bridge with two
new methods and reuses the host's existing, path-safe `writeItem` / `deleteItem`
(`packages/core/src/collection/server/io.ts`) — the exact functions the desktop
`PUT`/`DELETE /api/collections/:slug/items/:id` routes already drive.

**This PR (host repo) ships everything except the mulmoserver client:**

1. Core contract: `updateItem(id, patch)` / `deleteItem(id)` on `__MC_VIEW`
   (`@mulmoclaude/core/remote-view`), a `mc-remote-mutate` ⇄
   `mc-remote-mutate-result` message pair, protocol bumped `1 → 2`, and the
   parent-side `onMutate` responder in `handleRemoteViewMessage`. The methods are
   **installed only when the view declared write intent** — a read-only view's
   `updateItem` rejects loudly instead of silently no-op'ing.
2. Schema: `editableFields?: string[]` + `allowDelete?: boolean` on
   `CustomViewSchema` (discovery) and `CollectionCustomView` (core type),
   documented **mobile-only**. Default-deny: no `editableFields` ⇒ updates
   refused; no `allowDelete` ⇒ deletes refused.
3. Host: a shared `createMutateRemoteView(deps)` builder in `remoteView.ts`
   (find view → enforce mobile + write policy → merge patch / delete → `writeItem`
   / `deleteItem`), consumed by **two** thin adapters — a `mutateRemoteViewItem`
   channel handler (for the phone) and a `POST …/remote-view/:viewId/mutate`
   HTTP route (for the desktop preview). One authoritative enforcement point,
   two transports — the exact `getRemoteView` "one builder, two consumers"
   shape (decision 2/3 of phase 3).
4. Desktop preview: `onMutate` wired to **real host writes** through the new
   route, so a preview toggle really flips the record and the change event
   refreshes any open desktop view — "works in preview" means "works on the
   phone" (decision 5 of phase 3).
5. `custom-view-remote.md`: the write API + the `editableFields` / `allowDelete`
   declaration, with a writable-todo example.
6. `@mulmoclaude/core` 0.6.0 → 0.7.0 (contract change + help asset).

**Follow-up (separate repo/PR, after `@mulmoclaude/core@0.7.0` publishes):**
mulmoserver renders the srcdoc as before and answers the bridge's mutate
requests by calling `callHost(channel, "mutateRemoteViewItem", { slug, viewId,
op, id, patch })`, then refetches through its existing `useCollection`.

## The decisions that shape this

### 1. Writes stay on postMessage — CSP does not change

`updateItem` / `deleteItem` post a `mc-remote-mutate` to the parent and resolve
on the matching `mc-remote-mutate-result`, exactly like `getItems`. The view
never touches the network, so `connect-src 'none'` is preserved verbatim: a
writable view gains mutation power **without** gaining any network reach. The
parent is still the sole data authority; the sandbox guarantee is untouched.

### 2. Enforcement is host-side and default-deny — the client is never trusted

The sandboxed view is LLM-authored HTML; the bridge parent (preview / phone)
merely relays. **All policy lives in `createMutateRemoteView` on the host**, which
re-loads the collection and the view entry and checks, in order:

- the view exists and is `target: "mobile"` (a desktop view has no remote
  contract);
- **update**: every key in `patch` is listed in the view's `editableFields`
  (absent/empty ⇒ refuse); the primary key may not appear in a patch; the
  target record exists; the merged record is written whole via `writeItem`
  (`refuseOverwrite: false`, crash-atomic);
- **delete**: the view sets `allowDelete: true` (absent ⇒ refuse); `deleteItem`
  removes the record.

Both call the same `writeItem` / `deleteItem` that carry the workspace
containment + symlink-escape guards and publish `publishCollectionChange` so
live views refetch. A malicious or buggy view can therefore only touch the
fields its own declaration whitelisted, on its own collection — the blast radius
is exactly what the author declared, and nothing implicit.

### 3. Trust model — the phase-2 caveat comes due, and uid-scope still holds

Phase 2's trust model flagged this precise moment (its "Phase-3+ caveat"):
read-only handlers were safe under pure uid-scoped Firestore rules because "can
write to my own command queue" already implies workspace ownership. That
property is unchanged for **cross-tenant** safety: a command can only ever be
enqueued under `users/{uid}/hosts/mulmoclaude/commands`, which the deployed rule
restricts to the owning uid, so no other signed-in user can reach this host's
mutate handler. What the caveat actually asked for — *"per-slug scope"* so that
queue-ownership does not blanket-authorize mutating an arbitrary record — is
delivered by decision 2's **per-view `editableFields` / `allowDelete`
declaration**, enforced host-side. No new authz layer is required beyond that
declaration; the security boundary remains (a) the uid-scoped rules and (b) the
localhost-owner-only `signInHost` entry point.

### 4. Preview writes are real, through the host API

The desktop preview parent (MulmoClaude) *can* reach the host, so its `onMutate`
calls the new `POST …/remote-view/:viewId/mutate` route — a genuine write.
Consequences, all wanted: the write runs the identical `createMutateRemoteView`
enforcement the phone will run (preview can neither exceed nor undershoot phone
policy); the emitted change event refreshes the preview's own record source and
any open desktop collection view; and the author sees the true round-trip while
iterating. A simulated in-memory mutation would make "works in preview" weaker
and would not exercise the enforcement path — rejected for the same reason
phase 3 rejected a preview that offered more than the phone.

### 5. The view declares its own mutable surface — one place, host-enforced

`editableFields` / `allowDelete` live on the view's `views[]` entry, next to
`file`. They are the whole write contract: the host injects a `writable` boolean
into `__MC_VIEW` (true iff the view declares either), the bootstrap installs
`updateItem` / `deleteItem` only then, and the host re-derives and enforces the
same policy on every mutate (never trusting `writable`). Existing desktop
`capabilities: ["read","write"]` (token-scoped) is left untouched — it governs
the desktop `dataUrl` write channel, which the phone does not have; conflating
the two would overload one field across two unrelated transports.

## The mutate contract (core/remote-view)

```js
window.__MC_VIEW = {
  slug, locale, target: "mobile", protocol: 2,
  writable,                                     // NEW — mutate methods installed iff true
  getItems: ({ offset, limit, fields }) => Promise<page>,
  updateItem: (id, patch) => Promise<{ item }>, // NEW — patch = partial record; rejects if !writable
  deleteItem: (id)        => Promise<{ id }>,    // NEW — rejects if !writable
  startChat: (prompt, role) => void,
  t: (key, named) => string,
};
```

- **Messages** (`REMOTE_VIEW_MESSAGES`): add `mutate: "mc-remote-mutate"` (view →
  parent, `{ requestId, slug, op: "update" | "delete", id, patch? }`) and
  `mutateResult: "mc-remote-mutate-result"` (parent → view, `{ requestId, ok,
  result | error }`, where `result` is `{ item }` for update, `{ id }` for
  delete). `getItems`/`items`/`startChat` are unchanged; protocol `2` is a
  backward-compatible superset a stale phase-3 parent could still partly serve.
- **Bootstrap**: a single generic `call(type, payload)` correlates by
  `requestId` (used by `getItems` *and* both mutators, folding the existing
  `getItems`-only pending machine into one). The reply listener resolves on
  either `items` (→ `page`) or `mutateResult` (→ `result`). The mutators are
  installed only when `__MC_VIEW.writable`; otherwise they are stubs that reject
  `"this view is read-only"` so a mis-declared view fails loudly.
- **`handleRemoteViewMessage`**: a `mutate` branch normalizes `op`
  (`"update"|"delete"` only), `id` (→ String), and `patch` (plain object, else
  reject), calls `handlers.onMutate?.(req)`, and replies. A parent without
  `onMutate` (a read-only surface) replies `ok: false, "read-only"`. The `slug`
  guard and `event.source === iframe.contentWindow` discipline are unchanged.
- **Note — the view never sends its own `viewId`**: the parent (preview /
  mulmoserver) knows which view it mounted and supplies `viewId` to the host, so
  the sandboxed document stays dumb and cannot spoof a different view's policy.

## Where things live

```text
packages/core/src/remote-view/index.ts     ← + mutate messages, protocol 2,
  writable boot flag, updateItem/deleteItem bootstrap, normalizeMutate,
  onMutate in RemoteViewBridgeHandlers + handleRemoteViewMessage
packages/core/src/collection/server/discovery.ts ← editableFields/allowDelete on CustomViewSchema
packages/core/src/collection/core/schema.ts      ← same on CollectionCustomView
packages/core/assets/helps/custom-view-remote.md ← + write API + declaration + todo example
server/workspace/collections/remoteView.ts  ← createMutateRemoteView(deps):
  find view → mobile + write-policy guard → editableFields/allowDelete enforce →
  merge patch / delete → writeItem / deleteItem → discriminated result
server/remoteHost/handlers/mutateRemoteView.ts ← channel handler over the builder (registered)
server/api/routes/collections.ts            ← POST …/:slug/remote-view/:viewId/mutate (bearer)
src/config/apiRoutes.ts                      ← API_ROUTES.collections.remoteViewMutate
packages/plugins/collection-plugin/src/vue/
  uiContext.ts / host uiHost.ts              ← mutateRemoteView binding
  components/CollectionRemoteViewPreview.vue ← onMutate → real write, reflect change
```

## Schema

```jsonc
"views": [
  { "id": "phone", "label": "Todos", "target": "mobile", "file": "views/phone.html",
    "editableFields": ["done"],   // only these keys are patchable from the phone
    "allowDelete": true }          // omit (or false) to forbid delete
]
```

- `editableFields?: string[]` — the whitelist of patchable field names. Absent or
  empty ⇒ updates refused (default-deny). Never includes the primary key.
- `allowDelete?: boolean` — absent/`false` ⇒ deletes refused.
- Both are **ignored for desktop views** (they have their own token-scoped
  `capabilities`); documented as mobile-only in the type doc and the help file.
- Every existing mobile view (no new keys) stays exactly read-only.

## Host builder result (discriminated, like `RemoteViewBuildResult`)

```
{ kind: "ok"; op: "update"; item } | { kind: "ok"; op: "delete"; id }
| view-not-found | not-mobile | not-writable         (no editableFields & !allowDelete)
| field-not-editable(field) | delete-not-allowed
| item-not-found | invalid-id | path-escape | invalid-op | invalid-patch
```

`mutateRemoteViewFailureMessage(result, slug)` maps each non-ok kind to a
message the agent can act on (shared by the channel handler, which throws it,
and the HTTP route, which sends it with the matching status).

## Steps

0. Plan file (this document) on `feat/remote-writable-view`.
1. Core: mutate messages + protocol 2 + `writable` boot flag + bootstrap
   mutators + `normalizeMutate` + `onMutate` in the bridge handler. Unit tests
   (`packages/core/test/remote-view/`): mutators installed only when writable;
   `handleRemoteViewMessage` answers update/delete (ok + error), rejects bad
   op/patch, ignores foreign slug, replies read-only when `onMutate` absent;
   boot JSON carries `writable` + protocol 2; existing get-items/start-chat
   tests still pass.
2. Schema: `editableFields` / `allowDelete` on `CustomViewSchema` +
   `CollectionCustomView`. Extend discovery tests (accepts the keys, rejects
   non-array / non-bool, desktop view ignores them).
3. Host: `createMutateRemoteView` builder in `remoteView.ts` (engine stubbed in
   tests) + `mutateRemoteViewItem` channel handler (registered in
   `handlers/index.ts`) + `POST …/remote-view/:viewId/mutate` route +
   `API_ROUTES.collections.remoteViewMutate`. Tests in `test/remoteHost/`:
   not-mobile / not-writable / field-not-editable / delete-not-allowed /
   item-not-found refused; ok update returns the merged item; ok delete returns
   the id; handler registered in the runner table.
4. Preview: `mutateRemoteView` uiContext binding (+ `uiHost.ts` wiring calling
   the route), `onMutate` in `CollectionRemoteViewPreview.vue` → real write →
   re-derive/reflect (rely on the existing change subscription to refresh
   `items`; re-`getItems` in the view after a resolved mutate is the author's
   job, documented in the help file).
5. Help file: write API + declaration + a **writable mobile todo** example
   (checkbox toggles `done`, swipe/long-press deletes); core → 0.7.0.
6. `yarn format` / `lint` (--no-cache over new files) / `typecheck` / `build` /
   `test`; PR.

## Out of scope (later)

- **mulmoserver client** — needs `@mulmoclaude/core@0.7.0` on npm; a small
  consumer: render the srcdoc, answer `mutate` via
  `callHost("mutateRemoteViewItem", …)`, refetch through `useCollection`.
- **Create** (new records) from the phone — this phase is update + delete only
  (the two the read view naturally implies); create needs a form/field-init
  contract, its own phase.
- Multi-field transactional edits, optimistic-concurrency tokens, undo — a
  mutate is one field-set or one delete; last-write-wins as elsewhere.
- Feed-collection writes (`getRemoteView` / mutate load via `loadCollection`
  only; feeds are ingest-owned and stay read-only on the remote).

## Test plan

- **Core (`tsx --test`, packages/core)**: bootstrap installs mutators only when
  `writable`; message handler update/delete happy + error paths, malformed
  op/patch rejected, foreign slug ignored, read-only parent replies `ok:false`;
  boot carries `writable` + `protocol: 2`.
- **Host (`tsx --test`, test/remoteHost)**: `createMutateRemoteView` — desktop /
  unknown view refused, `not-writable` when neither `editableFields` nor
  `allowDelete`, `field-not-editable` for a non-whitelisted key, primary-key
  patch refused, `delete-not-allowed` without the flag, `item-not-found`,
  ok-update merges + returns item, ok-delete returns id (io stubbed);
  `mutateRemoteViewItem` registered; result shape as plain JSON.
- **Manual**: author a `target: "mobile"` view with `editableFields:["done"]` +
  `allowDelete:true` → preview renders → check a todo (record's `done` flips on
  disk, desktop view refreshes) → delete a record (file removed) → a
  non-whitelisted field patch is refused with the builder's message.
