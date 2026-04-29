import { API_ROUTES } from "../../config/apiRoutes";
import { getImageBump } from "./cacheBust";

// Files saved by `saveImage()` (Gemini, canvas, image edit) all live
// under this prefix — see server/utils/files/image-store.ts and
// server/workspace/paths.ts (WORKSPACE_DIRS.images). Express mounts a
// static handler for the corresponding URL so these paths route
// directly to the file without going through /api/files/raw.
const IMAGES_DIR_PREFIX = "artifacts/images/";

/** Convert an imageData value to a displayable URL.
 *  Handles data URIs, paths under `artifacts/images/` (resolved via
 *  the static mount), and everything else (resolved via the workspace
 *  file server). */
export function resolveImageSrc(imageData: string): string {
  if (imageData.startsWith("data:")) return imageData;
  if (imageData.startsWith(IMAGES_DIR_PREFIX)) return `/${imageData}`;
  return `${API_ROUTES.files.raw}?path=${encodeURIComponent(imageData)}`;
}

/** Same as `resolveImageSrc` but appends the current cache-bust token
 *  so the browser re-fetches when the file has been overwritten in
 *  place (e.g. the canvas plugin rewrote it).
 *
 *  Use this from display-only consumers (Preview, thumbnail list).
 *  Avoid inside the canvas View's own `backgroundImage` — changing
 *  that URL mid-session makes `vue-drawing-canvas` re-fetch on every
 *  redraw, which races with stroke painting and blanks the canvas. */
export function resolveImageSrcFresh(imageData: string): string {
  if (imageData.startsWith("data:")) return imageData;
  const base = resolveImageSrc(imageData);
  const bump = getImageBump(imageData);
  if (bump <= 0) return base;
  // Both URL forms append a cache-bust param. The static mount form
  // uses `?v=`, the API form already has `?path=` so we use `&v=`.
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}v=${bump}`;
}
