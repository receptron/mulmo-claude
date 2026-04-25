import { Router, Request, Response } from "express";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeWorkspaceText } from "../../utils/files/workspace-io.js";
import { buildArtifactPath } from "../../utils/files/naming.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";

const router = Router();

interface PresentHtmlBody {
  html: string;
  title?: string;
}

interface PresentHtmlSuccessResponse {
  message: string;
  instructions: string;
  data: { html: string; title?: string; filePath: string };
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
    res.json({
      message: `Saved HTML to ${filePath}`,
      instructions: "Acknowledge that the HTML page has been presented to the user.",
      data: { html, title, filePath },
    });
  } catch (err) {
    log.error("html", "present: threw", { error: errorMessage(err) });
    serverError(res, errorMessage(err));
  }
});

export default router;
