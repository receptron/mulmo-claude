import { Router, Request, Response } from "express";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeWorkspaceText } from "../../utils/files/workspace-io.js";
import { buildArtifactPath } from "../../utils/files/naming.js";
import { overwriteHtml, isHtmlPath } from "../../utils/files/html-store.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { publishFileChange } from "../../events/file-change.js";

const router = Router();

interface PresentHtmlBody {
  html: string;
  title?: string;
}

interface PresentHtmlSuccessResponse {
  message: string;
  instructions: string;
  data: { title?: string; filePath: string };
}

interface PresentHtmlErrorResponse {
  error: string;
}

type PresentHtmlResponse = PresentHtmlSuccessResponse | PresentHtmlErrorResponse;

router.post(API_ROUTES.html.present, async (req: Request<object, unknown, PresentHtmlBody>, res: Response<PresentHtmlResponse>) => {
  const { html, title } = req.body;
  log.info("html", "present: start", {
    titlePreview: typeof title === "string" ? previewSnippet(title) : undefined,
    bytes: typeof html === "string" ? html.length : undefined,
  });
  if (!html) {
    log.warn("html", "present: missing html");
    badRequest(res, "html is required");
    return;
  }

  try {
    const filePath = buildArtifactPath(WORKSPACE_DIRS.htmls, title, ".html", "page");
    await writeWorkspaceText(filePath, html);
    log.info("html", "present: ok", { filePath, bytes: html.length });
    // Fire-and-forget: any subscribed View tab refetches via cache-bust.
    void publishFileChange(filePath);
    res.json({
      message: `Saved HTML to ${filePath}`,
      instructions: "Acknowledge that the HTML page has been presented to the user.",
      data: { title, filePath },
    });
  } catch (err) {
    log.error("html", "present: threw", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

// Update html file on disk (user edits in View). Body carries the
// workspace-relative path verbatim (e.g.
// `artifacts/html/2026/04/page-abc.html`) so the route doesn't have to
// reconstruct one from a basename — same shape as plugins.updateMarkdown.
interface UpdateHtmlBody {
  relativePath: string;
  html: string;
}

interface UpdateHtmlSuccessResponse {
  path: string;
}

interface UpdateHtmlErrorResponse {
  error: string;
}

router.put(
  API_ROUTES.html.update,
  async (req: Request<object, unknown, UpdateHtmlBody>, res: Response<UpdateHtmlSuccessResponse | UpdateHtmlErrorResponse>) => {
    const { relativePath, html } = req.body;
    log.info("html", "update: start", {
      pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
      bytes: typeof html === "string" ? html.length : undefined,
    });
    if (!html) {
      log.warn("html", "update: missing html");
      badRequest(res, "html is required");
      return;
    }
    if (!relativePath || !isHtmlPath(relativePath)) {
      log.warn("html", "update: invalid relativePath", {
        pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
      });
      badRequest(res, "invalid html relativePath");
      return;
    }
    try {
      await overwriteHtml(relativePath, html);
      log.info("html", "update: ok", { pathPreview: previewSnippet(relativePath), bytes: html.length });
      void publishFileChange(relativePath);
      res.json({ path: relativePath });
    } catch (err) {
      log.error("html", "update: threw", { pathPreview: previewSnippet(relativePath), error: errorMessage(err) });
      serverError(res, errorMessage(err));
    }
  },
);

export default router;
