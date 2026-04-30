// Resolves a pasted/dropped chat attachment into a workspace-relative
// path the agent request body can carry on `selectedImageData`.
//
// All accepted MIME types (image, PDF, DOCX, XLSX, PPTX, text/*,
// JSON, XML, YAML, TOML) round-trip through POST /api/attachments,
// which saves the file under data/attachments/YYYY/MM/<id>.<ext>
// and returns the path. PPTX uploads also yield a `.pdf` companion;
// the route returns the PDF path so the LLM is handed a document
// Claude can natively read. The data: URI form is no longer sent to
// the agent route from the Vue UI.
//
// Background: feat/attachments-as-paths refactor. Earlier, only
// images were pre-uploaded (Stage 1 of stateless-image-editing) and
// non-image types still flowed as data: URIs through the server's
// mergeAttachments(). This unifies the path-first model.

import type { PastedFile } from "../../types/pastedFile";
import { apiPost } from "../api";
import { API_ROUTES } from "../../config/apiRoutes";

export type ResolveResult = { ok: true; value: string } | { ok: false; error: string };

interface UploadAttachmentResponse {
  path: string;
  originalPath: string;
  mimeType: string;
}

export async function resolvePastedAttachment(file: PastedFile): Promise<ResolveResult> {
  const upload = await apiPost<UploadAttachmentResponse>(API_ROUTES.attachments.upload, {
    dataUrl: file.dataUrl,
    filename: file.name,
  });
  if (!upload.ok) return { ok: false, error: upload.error };
  return { ok: true, value: upload.data.path };
}
