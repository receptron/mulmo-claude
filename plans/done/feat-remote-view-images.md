# feat: Workspace images in remote custom views — phase 5: inline thumbnails

## Goal

Phases 2–4 let the mobile remote **read** and **write** collections, but every
record field crosses the bridge as-is. A collection's `image`-type field holds a
**workspace-relative path** (`data/attachments/…`, `artifacts/images/…`,
`images/YYYY/MM/…`); on the desktop that path resolves through the localhost
`GET /api/files/raw` route, but the phone can't reach localhost, so
`custom-view-remote.md` today tells the agent to *"treat `image`-type fields as
desktop-only and skip or placeholder them."*

This phase makes workspace images **render on the phone** by inlining them as
**`data:` URL thumbnails** the host produces server-side. The view declares
which image fields to inline (`imageFields`); the host resizes + base64-encodes
each declared field's image and substitutes the path with the `data:` URL inside
the record page, within a byte budget that keeps the page under the 1 MiB
command-document cap. The CSP already allows `img-src … data:` (phase 3), so the
sandbox and transport are unchanged — this is purely a **field-value transform**
on the read path.

**This PR (host repo) ships everything except the mulmoserver client:**

1. Schema: `imageFields?: string[]` + `imageMaxEdge?: number` on
   `CustomViewSchema` (discovery) and `CollectionCustomView` (core type),
   documented **mobile-only**. Default-none: no `imageFields` ⇒ nothing is
   inlined (the cost-safe default — see below).
2. A host thumbnail resolver (`server/utils/files/thumbnail-store.ts`):
   workspace-relative path → resized JPEG `data:` URL, path-containment-guarded
   (same discipline as `image-store.ts`), with an mtime-keyed in-memory cache so
   repeated pages / "load more" scrolls never re-encode.
3. A shared `createRemoteViewItems(deps)` builder in `remoteView.ts`: load view
   (must be `target: "mobile"`) → derive → slice `offset/limit` → project
   `fields` → inline the declared `imageFields` that survived the projection,
   within a page byte budget → return one `RemoteViewPage`. Consumed by **two**
   thin adapters — a `getRemoteViewItems` channel handler (for the phone) and a
   `GET …/remote-view/:viewId/items` HTTP route (for the desktop preview). The
   exact `getRemoteView` / `mutateRemoteView` "one builder, two consumers" shape.
4. Desktop preview: `CollectionRemoteViewPreview.vue`'s `getPage` fetches pages
   from the new route instead of paging client-side over `props.items`, so the
   preview renders the **real host thumbnails** — "works in preview" means "works
   on the phone" (decision 5 of phase 3), and the preview exercises the same
   resolver + budget the phone will.
5. `custom-view-remote.md`: relax the "images are desktop-only" caveat; document
   `imageFields` / `imageMaxEdge`, the byte budget, and phone-image design
   guidance (small thumbnails, lazy-load pages). A new image-list example.
6. `@mulmoclaude/core` 0.7.1 → 0.8.0 (schema change + help asset).

**Follow-up (separate repo/PR, after `@mulmoclaude/core@0.8.0` publishes):**
mulmoserver answers the bridge's `getItems` by calling
`callHost(channel, "getRemoteViewItems", { slug, viewId, offset, limit, fields })`
— which already returns the page with `imageFields` inlined — instead of the
phase-2 `getCollection` + client-side `projectItems`.

## The decisions that shape this

### 1. Inline `data:` URLs, not a public URL or a fetch (Option A)

The phone can't reach the host and the CSP is `connect-src 'none'`, so an image
can arrive only two ways: as a **public `https:` URL** the phone fetches directly
(needs an external object store + an upload step — a different feature), or
**inlined as a `data:` URL** in the record the bridge already delivers. This
phase takes the inline path: no new transport, no new infrastructure, and the
image never leaves the machine at full resolution — the host emits a downscaled
thumbnail. `img-src … data:` is already open (phase 3), so nothing about the
sandbox or CSP changes.

### 2. The host resizes — a thumbnail, not the original

A workspace image is often multi-MB; base64 inflates bytes ~33% and the whole
page must fit the 1 MiB command doc. So the resolver **downscales** to a longest
edge (`imageMaxEdge`, default 512, clamped `[64, 1024]`) and re-encodes as JPEG
before base64 — the single biggest lever on both the size budget and egress cost.
This needs a decode/resize/encode dependency; the resolver is isolated behind one
function (`resolveThumbnail`) so the concrete library is an implementation
detail. **`sharp`** is the choice (prebuilt binaries for linux/mac/arm, the Node
thumbnailing standard); the resolver's signature stays library-agnostic so a
pure-JS swap is a one-file change.

### 3. Opt-in per view, projection-aware — cost is what the author declared

Egress is the only marginal cost of this feature (Firestore bills operations
per-document flat; a bigger page is bandwidth, not more ops). Two properties keep
it near-zero and *predictable*:

- **Opt-in**: no `imageFields` ⇒ zero thumbnails. A view pays for images only
  when it asks for them; the default card list and image-free views are
  unaffected.
- **Projection-aware**: the builder projects `fields` **before** inlining and
  only encodes `imageFields ∩ projected fields`. A view that pages a field list
  without its image column ships no image bytes for that page.

Firestore's ~10 GiB/mo free egress covers ~13k full image-pages/month at ~800 KB;
past that it's ~$0.12/GiB, linear and cheap. The budget guard (decision 4) caps
the worst case per page.

### 4. A hard per-page byte budget — the 1 MiB cap is never risked

The builder accumulates inlined thumbnail bytes and stops inlining once the page
would exceed `REMOTE_VIEW_ITEMS_MAX_BYTES` (900 000 — same headroom as the
srcdoc cap). Fields past the budget are **left as their original path string**
(the view already treats an unresolved image gracefully — it renders a broken/
placeholder `<img>`, same as a `null`). This means a runaway page (large images
× large `limit`) degrades to *fewer inlined images*, never a doc-write failure.
The resolver also returns `null` for a missing/unsupported/oversized source, and
those fields are likewise left as the path — one uniform "couldn't inline"
outcome the view handles the same way. Encourage small pages in the help file.

### 5. Preview pages from the host now — true thumbnail parity

The phase-3/4 preview paged **client-side** over `props.items` (`pageFromItems`),
which is impossible for thumbnails: the browser can't read the workspace or run
`sharp`. So the preview's `getPage` now fetches from
`GET …/remote-view/:viewId/items` — a real host call through the identical
`createRemoteViewItems` builder the phone uses. Consequences, all wanted: the
preview shows the **actual** downscaled thumbnails at the real byte cost; it can
neither exceed nor undershoot phone behavior; and `props.items` is no longer
needed by the preview (removed from the component and its `CollectionView.vue`
call site). This mirrors phase 4, which already made the preview's *writes* real
host round-trips for the same parity reason.

## The contract (core/remote-view)

No bootstrap or message-shape change — `getItems` still returns a `RemoteViewPage`
and the view still only `await`s it. What changes is purely the **value** of a
declared image field in the returned items: a `data:image/jpeg;base64,…` string
instead of a workspace path (or the path unchanged when it couldn't be inlined).

```js
// A view that declared "imageFields": ["photo"] sees, per record:
const page = await window.__MC_VIEW.getItems({ offset: 0, limit: 20, fields: ["title", "photo"] });
// page.items[0].photo === "data:image/jpeg;base64,/9j/4AAQ…"  (inlined thumbnail)
//   …or the original path string when the host could not inline it (budget/missing/unsupported)
```

Core additions are small: `REMOTE_VIEW_ITEMS_MAX_BYTES` and a
`DEFAULT_IMAGE_MAX_EDGE` / `clampImageMaxEdge` helper (params arrive as untyped
JSON, same as the pagination clamps), reused by the host builder.

## Schema

```jsonc
"views": [
  { "id": "gallery", "label": "Gallery", "target": "mobile", "file": "views/gallery.html",
    "imageFields": ["photo"],   // inline these image-type fields as data: thumbnails on the phone
    "imageMaxEdge": 384 }        // optional longest-edge px (default 512, clamped [64, 1024])
]
```

- `imageFields?: string[]` — the whitelist of `image`-type fields to inline.
  Absent/empty ⇒ nothing inlined (default-none, cost-safe). A named field that is
  not `image`-type in the schema is ignored (logged), not an error.
- `imageMaxEdge?: number` — longest-edge pixel bound; absent ⇒ 512, clamped.
- Both are **ignored for desktop views** (which resolve via `/api/files/raw`);
  documented mobile-only in the type doc and the help file.
- Every existing mobile view (no new keys) is byte-for-byte unchanged.

## Host builder result (discriminated, like the others)

```text
{ kind: "ok"; page: RemoteViewPage; inlined: number; omitted: number }
| view-not-found | not-mobile
```

`inlined` / `omitted` counts feed a debug log and the preview caption so the
author can *see* how many images fit the budget while iterating. Failure kinds
reuse `remoteViewItemsFailureMessage(result, slug)` shared by the channel handler
(throws) and the HTTP route (sends with status).

## Where things live

```text
packages/core/src/remote-view/index.ts     ← + REMOTE_VIEW_ITEMS_MAX_BYTES,
  DEFAULT_IMAGE_MAX_EDGE, clampImageMaxEdge (the only core code delta)
packages/core/src/collection/server/discovery.ts ← imageFields/imageMaxEdge on CustomViewSchema
packages/core/src/collection/core/schema.ts       ← same on CollectionCustomView
packages/core/assets/helps/custom-view-remote.md   ← relaxed image caveat + declaration + example
server/utils/files/thumbnail-store.ts       ← resolveThumbnail(relPath, maxEdge): data-URL | null,
  containment-guarded, sharp resize, mtime-keyed LRU cache
server/workspace/collections/remoteView.ts  ← createRemoteViewItems(deps): derive → slice →
  project → inline declared imageFields within budget → RemoteViewPage
server/remoteHost/handlers/getRemoteViewItems.ts ← channel handler over the builder (registered)
server/api/routes/collections.ts            ← GET …/:slug/remote-view/:viewId/items (bearer)
src/config/apiRoutes.ts                      ← API_ROUTES.collections.remoteViewItems
packages/plugins/collection-plugin/src/vue/
  uiContext.ts / host uiHost.ts             ← fetchRemoteViewItems binding
  components/CollectionRemoteViewPreview.vue ← getPage → route; drop props.items paging
  components/CollectionView.vue              ← stop passing :items to the preview
```

## Steps

0. Plan file (this document) on `feat/remote-view-images`.
1. Core: `REMOTE_VIEW_ITEMS_MAX_BYTES`, `DEFAULT_IMAGE_MAX_EDGE`,
   `clampImageMaxEdge`. Unit tests (clamp bounds).
2. Schema: `imageFields` / `imageMaxEdge` on `CustomViewSchema` +
   `CollectionCustomView`. Extend discovery tests (accepts keys, rejects
   non-array / non-number, desktop view ignores them).
3. Resolver: `server/utils/files/thumbnail-store.ts` + `sharp` dep. Unit tests
   (containment reject, cache hit skips re-encode, unsupported → null, resize
   honors max edge). Stub `sharp` in tests via a resize-fn dep so no real binary
   is needed in CI.
4. Host builder: `createRemoteViewItems` (engine + resolver stubbed in tests) +
   `getRemoteViewItems` channel handler (registered in `handlers/index.ts`) +
   `GET …/remote-view/:viewId/items` route + `API_ROUTES.collections.remoteViewItems`.
   Tests in `test/remoteHost/`: not-mobile refused; projection kept before
   inlining; only `imageFields ∩ projected` inlined; budget stops inlining and
   leaves the path; non-image field name ignored; result shape.
5. Preview: `fetchRemoteViewItems` uiContext binding (+ `uiHost.ts`), `getPage`
   → route (async), remove `props.items` from the component and `CollectionView.vue`.
6. Help file: relaxed caveat + declaration + image-list example; core → 0.8.0.
7. `yarn format` / `lint` (--no-cache over new files) / `typecheck` / `build` /
   `test`; PR.

## Out of scope (later)

- **mulmoserver client** — needs `@mulmoclaude/core@0.8.0`; a small consumer:
  call `getRemoteViewItems` for `getItems`, render the inlined `data:` URLs.
- **Public-URL (Option B) images** — full-resolution galleries too big for the
  command doc; needs an object store + publish step, its own phase.
- **Default card-list thumbnails** — the phase-2 `CollectionCardList` remote view
  could reuse `resolveThumbnail`, but this phase scopes to declared custom views.
- **Non-image media** (audio/video) inlining — far larger; stays public-URL-only.
- **Persistent / disk thumbnail cache** — the cache is in-memory per host process;
  a cross-restart cache is a later optimization.

## Test plan

- **Core (`tsx --test`, packages/core)**: `clampImageMaxEdge` bounds/defaults.
- **Resolver (`tsx --test`, test/utils)**: containment reject (path escape →
  null), cache hit avoids a second encode (spy the resize fn), unsupported bytes
  → null, honors `maxEdge`.
- **Host (`tsx --test`, test/remoteHost)**: `createRemoteViewItems` — not-mobile
  refused; page projected before inline; only declared ∩ projected fields
  inlined; budget exceeded ⇒ remaining fields left as path + `omitted` counted;
  non-image declared field ignored; `getRemoteViewItems` registered.
- **Manual**: author a `target: "mobile"` view with `imageFields` on a collection
  with real photos → preview renders the thumbnails in the 390×844 frame → the
  size caption shows the inlined-image page cost → a huge `limit` degrades to
  fewer images, never an error.