// POST /api/attachments — store a paste/drop/file-picker attachment
// under data/attachments/YYYY/MM/<id>.<ext> and return the path the
// LLM should reference.
//
// PPTX uploads also save a converted `.pdf` companion alongside the
// original (same `<id>` prefix) and return the PDF path as `path` so
// callers can hand the LLM a document Claude can natively read.
// Other types (image / PDF / DOCX / XLSX / text/* / JSON / XML / YAML)
// return the original's path; conversion (e.g. DOCX → text via
// mammoth) still happens at message-build time inside
// `attachmentConverter.ts`, but reads the file off disk now.

import { Router, Request, Response } from "express";
import { extname } from "path";
import { saveAttachment, saveCompanion, stripDataUri } from "../../utils/files/attachment-store.js";
import { convertPptxToPdf } from "../../agent/attachmentConverter.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { log } from "../../system/logger/index.js";

const router = Router();

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

interface UploadAttachmentBody {
  /** `data:<mime>;base64,...` from FileReader.readAsDataURL. */
  dataUrl: string;
  /** Original filename (optional — used only for log preview). */
  filename?: string;
}

interface UploadAttachmentResponse {
  /** Workspace-relative path the LLM should be handed. PPTX → the
   *  generated `.pdf` companion; everything else → the original. */
  path: string;
  /** Workspace-relative path of the original file as uploaded. Same
   *  as `path` for non-conversion cases. Surfaced so the client can
   *  show the original filename in the chat preview while still
   *  driving the LLM off the canonical `path`. */
  originalPath: string;
  /** MIME type of the file referenced by `path`. */
  mimeType: string;
}

interface UploadAttachmentError {
  error: string;
}

router.post(
  API_ROUTES.attachments.upload,
  async (req: Request<object, unknown, UploadAttachmentBody>, res: Response<UploadAttachmentResponse | UploadAttachmentError>) => {
    const { dataUrl, filename } = req.body;
    if (!dataUrl) {
      badRequest(res, "dataUrl is required");
      return;
    }
    const parsed = stripDataUri(dataUrl);
    if (!parsed) {
      badRequest(res, "dataUrl must be a data: URI");
      return;
    }
    log.info("attachments", "upload: start", {
      mimeType: parsed.mimeType,
      filename,
      bytes: Math.floor((parsed.base64.length * 3) / 4),
    });
    try {
      const original = await saveAttachment(parsed.base64, parsed.mimeType);
      if (parsed.mimeType === PPTX_MIME) {
        const pdfBuf = await convertPptxToPdf(parsed.base64);
        if (!pdfBuf) {
          // LibreOffice unavailable — return the original PPTX path
          // and let the agent loop produce its existing fallback
          // text block. Surfaces a warn so it doesn't disappear
          // silently in environments where conversion is expected.
          log.warn("attachments", "upload: pptx conversion unavailable, returning original", {
            path: original.relativePath,
          });
          res.json({ path: original.relativePath, originalPath: original.relativePath, mimeType: original.mimeType });
          return;
        }
        const pdfPath = await saveCompanion(original.relativePath, pdfBuf, ".pdf");
        log.info("attachments", "upload: ok", {
          path: pdfPath,
          originalPath: original.relativePath,
          conversion: "pptx-to-pdf",
        });
        res.json({ path: pdfPath, originalPath: original.relativePath, mimeType: "application/pdf" });
        return;
      }
      log.info("attachments", "upload: ok", {
        path: original.relativePath,
        ext: extname(original.relativePath),
      });
      res.json({ path: original.relativePath, originalPath: original.relativePath, mimeType: original.mimeType });
    } catch (err) {
      log.error("attachments", "upload: threw", { error: errorMessage(err) });
      serverError(res, errorMessage(err));
    }
  },
);

export default router;
