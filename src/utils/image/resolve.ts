import { API_ROUTES } from "../../config/apiRoutes";
import { getImageBump } from "./cacheBust";

/** Convert an imageData value to a displayable URL.
 *  Handles both legacy data URIs and workspace-relative file paths. */
export function resolveImageSrc(imageData: string): string {
  if (imageData.startsWith("data:")) return imageData;
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
  const base = `${API_ROUTES.files.raw}?path=${encodeURIComponent(imageData)}`;
  const bump = getImageBump(imageData);
  return bump > 0 ? `${base}&v=${bump}` : base;
}
