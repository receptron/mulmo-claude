// Resolves a pasted/dropped chat attachment into the value placed on
// the agent request body's `selectedImageData` field.
//
// Stage 1 of plans/refactor-stateless-image-editing.md: image
// attachments get pre-uploaded to /api/images so the server sees a
// workspace-relative path (artifacts/images/YYYY/MM/<id>.png) instead
// of a data: URI. This unifies the paste/drop path with the
// canvas/generateImage/editImage paths, all of which are already
// path-first. Non-image attachments (PDF, text, Office) keep flowing
// as data URIs and are unwrapped server-side by mergeAttachments().

import type { PastedFile } from "../../types/pastedFile";
import { apiPost } from "../api";
import { API_ROUTES } from "../../config/apiRoutes";

export type ResolveResult = { ok: true; value: string } | { ok: false; error: string };

export async function resolvePastedAttachment(file: PastedFile): Promise<ResolveResult> {
  if (!file.mime.startsWith("image/")) {
    return { ok: true, value: file.dataUrl };
  }
  const upload = await apiPost<{ path: string }>(API_ROUTES.image.upload, { imageData: file.dataUrl });
  if (!upload.ok) return { ok: false, error: upload.error };
  return { ok: true, value: upload.data.path };
}
