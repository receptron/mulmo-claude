# Canvas: PNG File as Source of Truth

Status: **shipped on `fix/canvas-png-source-of-truth`** (commits `4e88f7d`,
`25bfa23`, and the earlier `67b5d92` for the `applyStyle` fix).

## Problem

After reloading the page, the user's drawing on the canvas disappeared.
The PNG file was still on disk in `~/mulmoclaude/artifacts/images/`, but:

1. The session's persisted `tool_result` for `openCanvas` had no
   `data.imageData` — `executeOpenCanvas()` in
   `src/plugins/canvas/definition.ts` returned only `{ message,
   instructions, title }`. So reload could not find the file.
2. The `viewState.drawingState` (strokes, brush settings) was emitted
   client-side via `emit("updateResult", …)` on every autosave, but
   that only mutated the in-memory session — `handleUpdateResult` in
   `src/App.vue` was a client-only `Object.assign`. Nothing wrote it
   back to the server's session jsonl.

Result: on reload, the canvas opened blank, `imagePath` started empty,
and the next stroke created a **new** PNG via `POST /api/images`,
orphaning the old one on disk.

## Design: Stop Persisting Vectors

The drawing canvas used to try to persist two representations:

- The **raster** (PNG file on disk, via `POST`/`PUT /api/images`).
- The **vectors** (stroke array + brush settings in
  `viewState.drawingState`), which never made it to disk anyway.

Since only the raster survives, we made it the sole source of truth:

- Pre-allocate the PNG path when `openCanvas` is invoked. Bake the
  path into the tool result's `data.imageData` so it's persisted in
  the session jsonl for free (no client → server update required).
- On reload, the canvas View reads `data.imageData` and loads the
  file as its drawing canvas's `background-image`.
- Every stroke autosaves via `PUT` to that same file. No
  `emit("updateResult", …)` needed.
- Drop `CanvasDrawingState`, `initialStrokes`, `restoreDrawingState`,
  and all `viewState.drawingState` plumbing.

### What we lose

- Stroke-level undo/redo across reload. Already lost today — the
  strokes array was never persisted to the server.
- Brush size/color restoration on reload. Acceptable — that's a UI
  preference, not drawing content.

### What we gain

- Reload shows the drawing as the canvas's background, ready to
  draw on top of.
- No orphaned PNGs (autosaves always `PUT` the same file).
- No client → server sync path for canvas state.
- Simpler client code (net −40 lines of strokes / viewState handling
  in `View.vue`).

## Implementation

### 1. Server: pre-allocate the PNG file in the `/api/canvas` route

`server/api/routes/plugins.ts`:

```ts
const BLANK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

router.post(
  API_ROUTES.plugins.canvas,
  wrapPluginExecute(async () => {
    const imagePath = await saveImage(BLANK_PNG_BASE64);
    const base = await executeOpenCanvas();
    return { ...base, data: { imageData: imagePath, prompt: "" } };
  }),
);
```

- `saveImage` is already imported from `../../utils/files/image-store.js`.
- A real file must exist on disk: `overwriteImage` uses
  `resolveWithinRoot` (`server/utils/files/safe.ts:93-106`), which
  returns `null` when the target doesn't exist, so the first `PUT`
  would fail otherwise.

### 2. Server: fix the `PUT /api/images/:filename` path prefix

Discovered during implementation: the route was building
`relativePath = "images/${req.params.filename}"` while
`WORKSPACE_DIRS.images = "artifacts/images"`, so every PUT had been
failing `isImagePath` and the client had been silently POSTing a new
file on every autosave. Fix: use `WORKSPACE_DIRS.images` as the
prefix.

`server/api/routes/image.ts`:

```ts
const relativePath = `${WORKSPACE_DIRS.images}/${req.params.filename}`;
```

### 3. Client: View loads PNG, drops vector handling

`src/plugins/canvas/View.vue`:

- Deleted `CanvasDrawingState`, `initialStrokes`, `restoreDrawingState`,
  the `selectedResult` watcher, and the `emit("updateResult", …)` call
  inside `saveDrawing`.
- `imagePath` is now a `computed` reading `props.selectedResult.data.imageData`.
- `saveDrawing` just does: snapshot canvas bitmap → `PUT` overwrite →
  `bumpImage(imagePath)` for Preview. No result mutation. Kept the
  `uploadInFlight` / `pendingSave` queue so concurrent strokes don't
  fire overlapping uploads.

### 4. Use `background-image`, not `initial-image`

Initially planned to hand the PNG URL to `:initial-image`, but the
library's `initialImage` prop is typed `Array` (expects strokes, not a
URL). The `:background-image` prop is typed `String` and loads the URL
via `new Image().src = backgroundImage` inside the library's
`drawBackgroundImage` — exactly what we need for an editable base.

### 5. Cache-busting split by consumer

`PUT` overwrites the same URL, so the browser caches it — Preview
would never show mid-session updates. But we can't just append a bump
token to the canvas View's `backgroundImage` either: changing that
URL mid-session makes `vue-drawing-canvas` null its cached
`loadedImage`, and the next redraw races a fresh re-fetch against
stroke painting (`setBackground` only awaits the `$nextTick` tick,
not the inner `drawBackgroundImage` promise). Symptom: the second
stroke blanks the canvas.

Solution: two resolver functions.

`src/utils/image/resolve.ts`:

- `resolveImageSrc(path)` — plain URL, no cache-bust. Used by the
  canvas View's `backgroundImage`, combined with a per-mount token
  (`mt=<setupTime>-<canvasRenderKey>`) so the URL is stable for the
  lifetime of the `VueDrawingCanvas` child and only changes on
  deliberate remount (resize, page reload).
- `resolveImageSrcFresh(path)` — appends `&v=<bump>` from a shared
  reactive store (`src/utils/image/cacheBust.ts`). Used by
  `ImagePreview` and `ImageView` `<img>` tags. `saveDrawing` calls
  `bumpImage(path)` after each successful PUT.

This keeps Preview/thumbnail refreshing live while leaving the canvas
View's in-flight fetch stable.

### 6. Gate the child render until the container is measured

On reload, `VueDrawingCanvas` was mounting at the default 800×600,
then `onMounted` measured the real container (wider), bumped
`canvasRenderKey`, forcing an immediate remount. The first instance's
still-in-flight `Image.onload` fired on a detached context, and the
race left the canvas blank.

Fix in `src/plugins/canvas/View.vue`:

- `containerRef` on the wrapper div.
- `canvasWidth/Height` start at `0` and `<VueDrawingCanvas v-if="isSized">`
  doesn't render until `onMounted` has called `updateCanvasSize()`.
- After `await nextTick()` + measuring, we flip `isSized = true` and
  the canvas mounts **once** with the correct dimensions, fetches the
  background once, paints.
- User-triggered window resizes still bump `canvasRenderKey` (gated
  behind `isSized`) so the remount + cache-bust path keeps working.

### 7. Pre-req: `applyStyle` no longer bails on in-flight save

Shipped earlier on this branch as `67b5d92`. The old `applyStyle`
awaited `saveDrawingState()` and returned if it got `false`, but the
save function also returned `false` when an autosave was in flight
from the prior `mouseup` — so clicking a style button right after
drawing silently did nothing. New behavior: the button just emits
the text prompt; autosave from `mouseup` handles persistence.

## Files Touched

| File | Change |
|---|---|
| `server/api/routes/plugins.ts` | Wrap `executeOpenCanvas` to pre-allocate + inject `data.imageData`. |
| `server/api/routes/image.ts` | Fix PUT prefix to `WORKSPACE_DIRS.images`. |
| `src/plugins/canvas/definition.ts` | Drop `CanvasDrawingState` interface. |
| `src/plugins/canvas/View.vue` | Remove vector state; load PNG as `background-image`; per-mount cache-bust; `isSized` gate on child render. |
| `src/utils/image/resolve.ts` | Add `resolveImageSrcFresh` alongside the plain `resolveImageSrc`. |
| `src/utils/image/cacheBust.ts` | **New** — module-level reactive bump map. |
| `src/plugins/ui-image/ImagePreview.vue` | Switch to `resolveImageSrcFresh`. |
| `src/plugins/ui-image/ImageView.vue` | Switch to `resolveImageSrcFresh`. |
| `test/routes/test_canvasImageRoutes.ts` | **New** — 7 tests covering POST `/api/canvas` and PUT `/api/images/:filename` with HOME redirected to a tmp workspace and explicit file cleanup. |

## Testing

### Server-side unit (shipped)

`test/routes/test_canvasImageRoutes.ts` drives the handlers with
plain Request/Response mocks (pattern from `test_filesPutRoute.ts`):

- POST `/api/canvas`: pre-allocates `artifacts/images/<id>.png`,
  returns it in `data.imageData`, and two consecutive opens allocate
  distinct filenames.
- PUT `/api/images/:filename`: overwrites the allocated PNG (both
  data-URI and bare-base64 payloads); rejects missing `imageData`;
  rejects non-`.png` filenames (`isImagePath` gate); fails cleanly
  when the target doesn't exist.

HOME is redirected to a tmp dir **before** importing the route
modules so the tests never touch the real `~/mulmoclaude/`. `after()`
deletes each recorded image path and `rm -rf`'s the tmp root.

### Manual (verified during development)

- Draw → Preview updates mid-session (`resolveImageSrcFresh` bump).
- Draw stroke 2 → canvas shows both strokes (stable `backgroundImage`
  URL prevents the library's re-fetch race).
- Reload → drawing reappears as the canvas background, ready to
  draw on top of.
- `ls ~/mulmoclaude/artifacts/images/` → one PNG per canvas
  instance, not one per stroke (PUT path prefix fix).

### Out of scope

- Restoring stroke-level undo/redo across reload — would need a
  per-session stroke log; not worth the complexity.
- Cross-tab live updates — best-effort via the shared bump store
  within one tab; other tabs would need websocket fan-out.
- `VueDrawingCanvas` on resize: the new instance re-fetches the bg
  via a bumped `canvasRenderKey` token; if the user resizes mid-stroke
  (before `mouseup` fires `saveDrawing`), the in-memory strokes are
  lost. Edge case, accepted.
