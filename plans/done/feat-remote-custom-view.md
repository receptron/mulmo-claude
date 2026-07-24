# feat: Remote custom views — phase 3: LLM-generated mobile HTML views

## Goal

Let the agent author a **custom HTML view for the mobile remote** (the
`mulmoserver` app) the same way it already authors desktop custom views
(`config/helps/custom-view.md`), and let the user **preview it on MulmoClaude
inside a phone-sized iframe** so the generate → review → tweak loop never needs
a phone. Builds on phase 2 (`plans/feat-remote-collection-view.md`, shipped):
the remote already renders any collection through the default
`CollectionCardList`; this phase adds the per-collection bespoke view on top —
the mobile-native analogue of the desktop's sandboxed custom-HTML `views`.

**This PR (host repo) ships everything except the mulmoserver client:**

1. `views[]` schema: a `target: "mobile"` discriminator.
2. `@mulmoclaude/core/remote-view` — a **browser-safe** subpath owning the whole
   contract: CSP, srcdoc wrapping + injected bootstrap, pagination clamps +
   field projection, and the parent-side message handler. Single source of
   truth for both the desktop preview and (post-publish) mulmoserver.
3. Host: a `getRemoteView` command-channel handler + a
   `GET /api/collections/:slug/remote-view` route, both over one shared builder.
4. Desktop preview: mobile-target views render in a phone-sized (390×844)
   sandboxed iframe inside the collection's existing view selector.
5. `config/helps/custom-view-remote.md` — the one-shot authoring spec, with a
   **mobile-layout** example (the agent copies the example's shape, so the
   example must itself be a phone layout).
6. `@mulmoclaude/core` 0.5.1 → 0.6.0 (new subpath + new help asset).

**Follow-up (separate repo/PR, after `@mulmoclaude/core@0.6.0` publishes):**
mulmoserver calls `getRemoteView`, renders the returned srcdoc in a sandboxed
iframe, and answers the bridge's `getItems` requests through its existing
`useCollection`/`callHost`.

## The decisions that shape this

### 1. Data over postMessage, not fetch (the phone can't reach the host)

The desktop custom view fetches `/api/collections/:slug/view-data` with a
scoped token. On a phone that URL points at the host's localhost —
unreachable — and handing the iframe Firestore credentials would break the
sandbox's whole point. So the remote contract replaces `token`/`dataUrl` with
an **async postMessage bridge**: the parent page owns the data channel; the
injected bootstrap exposes

```js
window.__MC_VIEW = {
  slug, locale, target: "mobile", protocol: 1,
  getItems: ({ offset, limit, fields }) => Promise<{ items, total, offset, limit }>,
  startChat: (prompt, role) => void,   // same message type as desktop (mc-start-chat)
  t: (key, named) => string,           // same host-picked dict helper as desktop
};
```

`getItems` posts `{ type: "mc-remote-get-items", slug, requestId, offset,
limit, fields }` to the parent and resolves on the matching
`{ type: "mc-remote-items", requestId, ok, page | error }` reply (30 s timeout,
matching `callHost`). Request/response correlation lives entirely in the
injected bootstrap — the LLM-authored view only ever awaits a function.

Reply/request `targetOrigin` is `"*"`: the sandboxed iframe has an opaque
origin so nothing else matches, requests carry no secret, and the parent is by
construction the party that supplies the data anyway. The parent validates
`event.source === iframe.contentWindow` before answering (same discipline as
`CollectionCustomView.vue`).

### 2. The host wraps the srcdoc — parity is structural, not disciplined

`buildRemoteViewSrcdoc` (CSP meta + bootstrap injection) runs **server-side**
inside the `getRemoteView` builder. The phone and the desktop preview both
receive the same finished artifact; neither re-implements the contract.
mulmoserver (which today has **zero** workspace-package deps) only needs a dumb
`<iframe :srcdoc>` plus the small parent-side responder — and that responder
(`handleRemoteViewMessage`) is exported browser-safe from
`@mulmoclaude/core/remote-view` so the desktop preview uses it today and
mulmoserver adopts it once the package is a dependency.

### 3. CSP is _stricter_ than desktop: `connect-src 'none'`

Data arrives via postMessage, so the view needs no network channel at all —
the fetch/XHR/WebSocket/sendBeacon exfiltration surface disappears. What stays
open (the phone has internet; only the _host_ is unreachable):

- `script-src` / `style-src` / `font-src`: `'unsafe-inline'` + the same curated
  CDN allowlist as desktop views (Chart.js / D3 etc. still load). The allowlist
  constant moves to `@mulmoclaude/core/remote-view`
  (`SANDBOXED_VIEW_CDN_ALLOWLIST`); `src/utils/html/previewCsp.ts` re-exports it
  as its default so the two policies can't drift.
- `img-src` / `media-src`: CDNs + `data:` + `blob:` + any `https:` — record
  image/media URLs pointing at public hosts render on the phone. Host-local
  image fields do **not** (they're localhost URLs); the help file says to treat
  `image` fields as desktop-only. Same one-way GET-exfil tradeoff as desktop,
  accepted for the same reasons — and `connect-src 'none'` keeps it one-way.

### 4. 1 MiB — the srcdoc travels through a Firestore command document

The command channel writes results inside the command doc (1 MiB cap). The
builder enforces `REMOTE_VIEW_MAX_BYTES` (900 000 bytes of srcdoc, leaving
envelope headroom) and throws a byte-count error the agent can act on. The
desktop preview surfaces the byte size as a caption so the budget is visible
while iterating. Record pages reuse the phase-2 clamps — `clampOffset` /
`clampLimit` move into `core/remote-view` and
`server/remoteHost/handlers/collectionPage.ts` imports them from there
(one clamp, two consumers).

### 5. Preview capability == phone capability, exactly

A preview that offers more than the phone runtime makes "works in preview"
meaningless. The preview parent answers **only** `mc-remote-get-items`
(pages sliced from the items it already loaded, `fields`-projected — identical
observable behavior to the phone paging over the channel) and relays
`mc-start-chat`. No `onChange`, no `openItem`, no fetchable data plane —
because phase-3 mulmoserver has none of those either. When a later phase adds
one of them to the phone, the preview gains it in the same PR.

## Where things live

```text
packages/core/src/remote-view/index.ts     ← the whole contract (browser-safe):
  REMOTE_VIEW_PROTOCOL, REMOTE_VIEW_MESSAGES, REMOTE_VIEW_MAX_BYTES,
  DEFAULT_PAGE_LIMIT / MAX_PAGE_LIMIT, clampOffset / clampLimit,
  projectItems / pageFromItems, SANDBOXED_VIEW_CDN_ALLOWLIST,
  buildRemoteViewCsp, buildRemoteViewSrcdoc, handleRemoteViewMessage
packages/core/assets/helps/custom-view-remote.md   ← the authoring spec
server/workspace/collections/remoteView.ts ← createBuildRemoteView(deps):
  load view entry (must be target "mobile") → readCustomViewHtml →
  readCustomViewI18n (when declared) → buildRemoteViewSrcdoc → size guard →
  { view: {id,label,icon,target}, srcdoc, bytes }
server/remoteHost/handlers/getRemoteView.ts← channel handler over the builder
server/api/routes/collections.ts           ← GET …/:slug/remote-view (bearer)
packages/plugins/collection-plugin/src/vue/components/
  CollectionRemoteViewPreview.vue           ← phone frame + bridge responder
```

Schema (`discovery.ts` `CustomViewSchema` + the `CollectionCustomView` type):
`target: z.enum(["desktop", "mobile"]).optional()` — absent means desktop, so
every existing view keeps its exact behavior. A mobile view's selector button
defaults to the `smartphone` icon and renders the preview instead of
`CollectionCustomView`. `getRemoteView` and the HTTP route refuse non-mobile
views (a desktop view's HTML assumes `token`/`dataUrl` and would just break on
the phone).

Registration example the help file teaches:

```jsonc
"views": [
  { "id": "phone", "label": "Phone", "target": "mobile", "file": "views/phone.html" }
]
```

## Steps

0. Plan file (this document) on a fresh branch.
1. Core: `remote-view` module + package.json/vite entries + unit tests
   (`packages/core/test/remote-view/`): CSP says `connect-src 'none'` and
   carries no token; srcdoc injects at head-start and `<`-escapes the boot
   JSON; clamps mirror phase-2 semantics; `projectItems` always keeps the
   primary key; `handleRemoteViewMessage` answers get-items (ok + error paths),
   ignores foreign slugs/types, relays start-chat.
2. Schema: `target` on `CustomViewSchema` (discovery) + `CollectionCustomView`
   (core type). Existing discovery tests extended.
3. Host server: `remoteView.ts` builder (factory, engine stubbed in tests) +
   `getRemoteView` channel handler (registered in `handlers/index.ts`) +
   `remoteView` route + `API_ROUTES.collections.remoteView`; collectionPage.ts
   re-imports the clamps from core. Tests in `test/remoteHost/`.
4. Desktop preview: `fetchRemoteView` uiContext binding (+ uiHost.ts wiring),
   `CollectionRemoteViewPreview.vue`, CollectionView.vue branch + smartphone
   default icon. Reuses the existing `customViewLoading` / `customViewError`
   i18n keys; the byte caption is numeric ("N KB / 1,024 KB") so no new locale
   keys are needed.
5. Help file `custom-view-remote.md` (mobile-first example) + pointer lines in
   `index.md`, `collection-skills.md`, and `custom-view.md`; core → 0.6.0.
   Plus a routing section in `server/prompts/system/system.md`: help files are
   only read when something routes the agent to them — a live test showed a
   "create a remote version of this view" request being satisfied by baking
   records into a standalone HTML artifact because nothing in context said the
   remote contract existed. The system prompt now names both contracts and the
   trigger words (remote / mobile / phone / スマホ).
6. `yarn format` / `lint` (--no-cache over new files) / `typecheck` / `build` /
   `test`; PR.

## Out of scope (later)

- **mulmoserver client** (the actual phone rendering) — needs
  `@mulmoclaude/core@0.6.0` on npm first; it is a small consumer of the
  contract this PR freezes: call `getRemoteView`, render `srcdoc` sandboxed,
  answer the bridge with `handleRemoteViewMessage` + pages from
  `useCollection`, apply `projectItems` for `fields`.
- Feed-collection mobile views (`getRemoteView` loads via `loadCollection`
  only; feeds resolve their views the same way desktop feeds do — extend when
  the remote grows a feed view surface).
- Live refresh (`onChange`), `openItem`, writes — each lands on the phone
  first, preview in the same PR (decision 5).
- Generation-time size linting beyond the builder's hard cap.

## Test plan

- **Core (`tsx --test`, packages/core)**: CSP policy string; srcdoc wrap
  (head injection, fragment wrapping, escaping); clamp + projection semantics;
  message handler request/response including malformed input.
- **Host (`tsx --test`, test/remoteHost)**: builder — unknown slug rejected at
  the handler, unknown/desktop-target view refused, i18n dict picked when
  declared, size guard throws past `REMOTE_VIEW_MAX_BYTES`; handler registered
  in the runner's method table; result shape
  `{ view, srcdoc, bytes }` with plain-JSON casts like phase 2.
- **Manual**: author a `target: "mobile"` view on a real collection → the
  selector shows the phone button → preview renders in the 390×844 frame,
  pages through `getItems`, byte caption matches, `startChat` opens a draft.
