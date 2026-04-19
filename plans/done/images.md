# Plan: File-Based Image Storage

## Problem

Generated/edited/drawn images are stored as base64-encoded data URIs directly inside chat JSONL files. A single image is ~2-3 MB of base64 text. This bloats session files, slows session loading, and wastes memory when the full conversation is sent to the frontend.

## Goal

Store all images as PNG files in `{workspace}/images/` and replace inline base64 with file references (e.g. `"images/{uuid}.png"` — no leading slash). The frontend fetches images via the existing `/api/files/raw?path=...` route.

## Design

### Image reference format

Replace `data:image/png;base64,...` with a workspace-relative path:

```
images/{uuid}.png
```

The `data.imageData` field in ToolResult changes from a data URI to this relative path. The frontend resolves it to a URL for display.

### Affected flows

| Flow | Where base64 is created | Change |
|---|---|---|
| **generateImage** | `server/api/routes/image.ts` `/generate-image` | Write PNG to disk, return path |
| **editImage** | `server/api/routes/image.ts` `/edit-image` | Write PNG to disk, return path |
| **openCanvas** (drawing) | `src/plugins/canvas/View.vue` `saveDrawingState()` | POST base64 to new endpoint, get back path |
| **editImage** (input) | `server/api/routes/image.ts` reads `selectedImageData` from session | Resolve path → read file from disk |

### Storage layout

```
~/mulmoclaude/
  images/
    a1b2c3d4.png
    e5f6g7h8.png
    ...
```

## Implementation Steps

### Step 1: Add `images/` to workspace

**File: `server/workspace/workspace.ts`**

- Add `"images"` to the `SUBDIRS` array so `initWorkspace()` creates it.

### Step 2: Create image storage utility

**New file: `server/utils/image-store.ts`**

```typescript
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { workspacePath } from "../workspace.js";

const IMAGES_DIR = path.join(workspacePath, "images");

/** Save raw base64 (no data URI prefix) as a PNG file. Returns the workspace-relative path. */
export async function saveImage(base64Data: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const filename = `${id}.png`;
  const absPath = path.join(IMAGES_DIR, filename);
  await fs.writeFile(absPath, Buffer.from(base64Data, "base64"));
  return `images/${filename}`;
}

/** Read an image file and return raw base64 (no data URI prefix). */
export async function loadImageBase64(relativePath: string): Promise<string> {
  const absPath = path.join(workspacePath, relativePath);
  const buf = await fs.readFile(absPath);
  return buf.toString("base64");
}

/** Convert a data URI to raw base64. */
export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/[^;]+;base64,/, "");
}

/** Check if a string is a file reference (not a data URI). */
export function isImagePath(value: string): boolean {
  return value.startsWith("images/") && value.endsWith(".png");
}
```

### Step 3: Update server image routes

**File: `server/api/routes/image.ts`**

**`/generate-image`:**
- After receiving `imageData` (raw base64) from Gemini, call `saveImage(imageData)`.
- Return the path instead of a data URI in `data.imageData`.

**`/edit-image`:**
- When reading the input image from session: if `selectedImageData` is a path (not a data URI), call `loadImageBase64()` to get the base64 for Gemini.
- After receiving the edited image, call `saveImage()` and return the path.

### Step 4: Add image serving awareness to frontend

**New utility: `src/utils/image/resolve.ts`**

```typescript
/** Convert an imageData value to a displayable URL. */
export function resolveImageSrc(imageData: string): string {
  if (imageData.startsWith("data:")) return imageData; // legacy data URI
  return `/api/files/raw?path=${encodeURIComponent(imageData)}`;  // file reference
}
```

This provides backward compatibility — old sessions with inline base64 still render.

### Step 5: Update frontend image rendering

All places that bind `:src="result.data?.imageData"` need to use `resolveImageSrc()`:

- **`src/plugins/generateImage/View.vue`** — passes to `@mulmochat-plugin/ui-image` `ImageView` (may need to transform before passing)
- **`src/plugins/generateImage/Preview.vue`** — uses `ImagePreview`
- **`src/plugins/editImage/View.vue`** — direct `<img :src>`
- **`src/plugins/editImage/Preview.vue`** — direct `<img :src>`
- **`src/plugins/canvas/Preview.vue`** — direct `<img :src>`

### Step 6: Update canvas drawing save flow

The canvas calls `saveDrawingState()` on every stroke end, undo, redo, clear, and brush change. It must **not** create a new image file each time — it must overwrite the same file.

**File: `server/api/routes/image.ts`** (or `server/api/routes/plugins.ts`)

Add a new endpoint:

```
PUT /api/images/:path
Body: { imageData: "data:image/png;base64,..." }
Response: { path: "images/abc123.png" }
```

When `path` is omitted (or a POST to `/api/images`), generate a new UUID filename. When `path` is provided, overwrite the existing file. This lets the canvas allocate one filename on first save and reuse it for all subsequent strokes.

**File: `src/plugins/canvas/View.vue`**

Change `saveDrawingState()`:

1. On first save (no `data.imageData` path yet): POST to `/api/images` → receive a new path like `images/abc123.png`.
2. On subsequent saves: PUT to `/api/images/images/abc123.png` with the updated base64 → overwrites the same file.
3. Store the returned path in `data.imageData` (unchanged after first save).

The image path is persisted in the ToolResult, so reopening the canvas result reuses the same file.

Note: `viewState.drawingState.strokes` remains in the ToolResult (it's small and needed for canvas restoration).

### Step 7: Update session `selectedImageData` handling

**File: `server/sessions.ts`** and **`server/api/routes/agent.ts`**

When the frontend sends `selectedImageData` for an edit session, it may now be a file path instead of a data URI. The `getSessionImageData()` function and its consumers must handle both formats.

### Step 8: Update `pushToSession` (optional optimization)

**File: `server/sessions.ts`**

No change needed if the server routes already store paths before pushing ToolResults. The JSONL will naturally contain paths instead of base64.

## Backward Compatibility

- `resolveImageSrc()` handles both data URIs (old sessions) and file paths (new sessions).
- `isImagePath()` / data URI detection in server routes handles both formats for `selectedImageData`.
- Old JSONL files remain valid and renderable without migration.

## File Changes Summary

| File | Action |
|---|---|
| `server/workspace/workspace.ts` | Add `"images"` to SUBDIRS |
| `server/utils/image-store.ts` | **New** — save/load/utility functions |
| `server/api/routes/image.ts` | Save to disk instead of returning base64 |
| `src/utils/image/resolve.ts` | **New** — resolve image path to URL |
| `src/plugins/generateImage/View.vue` | Use `resolveImageSrc()` |
| `src/plugins/generateImage/Preview.vue` | Use `resolveImageSrc()` |
| `src/plugins/editImage/View.vue` | Use `resolveImageSrc()` |
| `src/plugins/editImage/Preview.vue` | Use `resolveImageSrc()` |
| `src/plugins/canvas/View.vue` | POST drawing to `/api/images`, use path |
| `src/plugins/canvas/Preview.vue` | Use `resolveImageSrc()` |
| `server/sessions.ts` | Handle path-based selectedImageData |
