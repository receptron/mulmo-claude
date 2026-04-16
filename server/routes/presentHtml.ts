import { Router, Request, Response } from "express";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../workspace-paths.js";
import { slugify } from "../utils/slug.js";
import { errorMessage } from "../utils/errors.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";

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

type PresentHtmlResponse =
  | PresentHtmlSuccessResponse
  | PresentHtmlErrorResponse;

router.post(
  API_ROUTES.html.present,
  async (
    req: Request<object, unknown, PresentHtmlBody>,
    res: Response<PresentHtmlResponse>,
  ) => {
    const { html, title } = req.body;
    if (!html) {
      res.status(400).json({ error: "html is required" });
      return;
    }

    try {
      const slug = title ? slugify(title) : "page";
      const fname = `${slug}-${Date.now()}.html`;
      const htmlDir = WORKSPACE_PATHS.htmls;
      await mkdir(htmlDir, { recursive: true });
      await writeFile(path.join(htmlDir, fname), html, "utf-8");

      const filePath = `${WORKSPACE_DIRS.htmls}/${fname}`;
      res.json({
        message: `Saved HTML to ${filePath}`,
        instructions:
          "Acknowledge that the HTML page has been presented to the user.",
        data: { html, title, filePath },
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

export default router;
