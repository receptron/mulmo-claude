import { Router, Request, Response } from "express";
import { executeMindMap } from "@gui-chat-plugin/mindmap";
import { executeSpreadsheet, type SpreadsheetArgs } from "../../../src/plugins/spreadsheet/definition.js";
import { executeQuiz } from "@mulmochat-plugin/quiz";
import { executeForm } from "../../../src/plugins/presentForm/plugin.js";
import { executeOpenCanvas } from "../../../src/plugins/canvas/definition.js";
import { executePresent3D } from "@gui-chat-plugin/present3d";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { saveImage } from "../../utils/files/image-store.js";
import { fillMarkdownImagePlaceholders } from "../../utils/files/markdown-image-fill.js";
import { saveMarkdown, overwriteMarkdown, isMarkdownPath } from "../../utils/files/markdown-store.js";
import { saveSpreadsheet, overwriteSpreadsheet, isSpreadsheetPath } from "../../utils/files/spreadsheet-store.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { publishFileChange } from "../../events/file-change.js";

const router = Router();

interface PluginErrorResponse {
  message: string;
}

// Wraps a plugin's `execute*` invocation in an Express handler. Each
// plugin route used to inline the same try/catch + 500 response shell;
// this collapses them to one line per route.
//
// The callback receives the Express request and is responsible for
// pulling whatever it needs out of `req.body` and forwarding it to
// the plugin's execute function. `req.body` is `any` by Express
// default and each plugin's execute function does its own runtime
// validation — matching the behavior of the inline handlers this
// replaces.
//
// Logging policy (#779): a single entry/success/error log here covers
// every route that adopts this wrapper (mindmap / quiz / form /
// canvas / present3d / presentSpreadsheet). Without it, plugin
// errors used to land as a generic 500 response with no server-log
// trace — exactly the silent-failure pattern the audit is closing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapPluginExecute<TBody = any, TResult = unknown>(
  execute: (req: Request<object, unknown, TBody>) => Promise<TResult>,
): (req: Request<object, unknown, TBody>, res: Response<TResult | PluginErrorResponse>) => Promise<void> {
  return async (req, res) => {
    // `req.path` here is the absolute path under the router's mount —
    // useful as a per-call identifier without having to thread the
    // plugin name through every call site.
    log.info("plugins", "execute: start", { route: req.path });
    try {
      const result = await execute(req);
      log.info("plugins", "execute: ok", { route: req.path });
      res.json(result);
    } catch (err) {
      log.error("plugins", "execute: threw", { route: req.path, error: errorMessage(err) });
      res.status(500).json({ message: errorMessage(err) });
    }
  };
}

// presentDocument — fills image placeholders via Gemini if API key is available
interface PresentDocumentBody {
  title: string;
  markdown: string;
  filenamePrefix: string;
}

interface PresentDocumentSuccess {
  message: string;
  instructions: string;
  title: string;
  data: { markdown: string; filenamePrefix: string };
}

interface PresentDocumentError {
  error: string;
}

router.post(
  API_ROUTES.plugins.presentDocument,
  async (req: Request<object, unknown, PresentDocumentBody>, res: Response<PresentDocumentSuccess | PresentDocumentError>) => {
    const { title, markdown, filenamePrefix } = req.body;
    log.info("plugins", "presentDocument: start", {
      titlePreview: typeof title === "string" ? previewSnippet(title) : undefined,
      prefixPreview: typeof filenamePrefix === "string" ? previewSnippet(filenamePrefix) : undefined,
      markdownBytes: typeof markdown === "string" ? markdown.length : undefined,
    });
    if (typeof filenamePrefix !== "string" || filenamePrefix.trim().length === 0) {
      log.warn("plugins", "presentDocument: missing filenamePrefix");
      badRequest(res, "filenamePrefix is required");
      return;
    }
    const filledMarkdown = await fillMarkdownImagePlaceholders(markdown);
    const markdownPath = await saveMarkdown(filledMarkdown, filenamePrefix);
    log.info("plugins", "presentDocument: ok", { markdownPath, bytes: filledMarkdown.length });
    res.json({
      message: `Saved markdown to ${markdownPath}`,
      instructions: "Acknowledge that the document has been presented to the user.",
      title,
      data: { markdown: markdownPath, filenamePrefix },
    });
  },
);

// Update markdown file on disk (user edits in View). Body carries the
// workspace-relative path verbatim (e.g.
// `artifacts/documents/2026/04/abc-123.md`) so the route doesn't have
// to reconstruct one from a basename — required after #764 sharded
// `artifacts/documents` by YYYY/MM.
interface UpdateMarkdownBody {
  relativePath: string;
  markdown: string;
}

interface UpdateMarkdownResponse {
  path: string;
}

interface UpdateMarkdownError {
  error: string;
}

router.put(
  API_ROUTES.plugins.updateMarkdown,
  async (req: Request<object, unknown, UpdateMarkdownBody>, res: Response<UpdateMarkdownResponse | UpdateMarkdownError>) => {
    const { relativePath, markdown } = req.body;
    log.info("plugins", "updateMarkdown: start", {
      pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
      bytes: typeof markdown === "string" ? markdown.length : undefined,
    });
    if (!markdown) {
      log.warn("plugins", "updateMarkdown: missing markdown");
      badRequest(res, "markdown is required");
      return;
    }
    if (!relativePath || !isMarkdownPath(relativePath)) {
      log.warn("plugins", "updateMarkdown: invalid relativePath", {
        pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
      });
      badRequest(res, "invalid markdown relativePath");
      return;
    }
    try {
      await overwriteMarkdown(relativePath, markdown);
      log.info("plugins", "updateMarkdown: ok", { pathPreview: previewSnippet(relativePath), bytes: markdown.length });
      void publishFileChange(relativePath);
      res.json({ path: relativePath });
    } catch (err) {
      log.error("plugins", "updateMarkdown: threw", { pathPreview: previewSnippet(relativePath), error: errorMessage(err) });
      serverError(res, errorMessage(err));
    }
  },
);

// `null as never` in the calls below: each plugin's `execute*`
// function expects a client-side context object as its first
// argument. The server-side bridge has no such context — these
// functions only touch their second arg (the request body) on this
// path — so we satisfy the type signature with a never cast rather
// than fabricating a fake context.

// presentSpreadsheet — validate, then save sheets to disk
router.post(
  API_ROUTES.plugins.presentSpreadsheet,
  wrapPluginExecute<SpreadsheetArgs, unknown>(async (req) => {
    const result = await executeSpreadsheet(req.body);
    if (!Array.isArray(result.data.sheets)) {
      throw new Error("Expected sheets array from executeSpreadsheet");
    }
    const sheetsPath = await saveSpreadsheet(result.data.sheets);
    return { ...result, data: { ...result.data, sheets: sheetsPath } };
  }),
);

// Update spreadsheet file on disk (user edits in View). Body carries
// the workspace-relative path so the route is symmetric with
// updateMarkdown / image.update — see #764.
interface UpdateSpreadsheetBody {
  relativePath: string;
  sheets: unknown[];
}

interface UpdateSpreadsheetResponse {
  path: string;
}

interface UpdateSpreadsheetError {
  error: string;
}

router.put(
  API_ROUTES.plugins.updateSpreadsheet,
  async (req: Request<object, unknown, UpdateSpreadsheetBody>, res: Response<UpdateSpreadsheetResponse | UpdateSpreadsheetError>) => {
    const { relativePath, sheets } = req.body;
    log.info("plugins", "updateSpreadsheet: start", {
      pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
      sheetCount: Array.isArray(sheets) ? sheets.length : undefined,
    });
    if (!Array.isArray(sheets)) {
      log.warn("plugins", "updateSpreadsheet: sheets not an array");
      badRequest(res, "sheets must be an array");
      return;
    }
    if (!relativePath || !isSpreadsheetPath(relativePath)) {
      log.warn("plugins", "updateSpreadsheet: invalid relativePath", {
        pathPreview: typeof relativePath === "string" ? previewSnippet(relativePath) : undefined,
      });
      badRequest(res, "invalid spreadsheet relativePath");
      return;
    }
    try {
      await overwriteSpreadsheet(relativePath, sheets);
      log.info("plugins", "updateSpreadsheet: ok", { pathPreview: previewSnippet(relativePath), sheetCount: sheets.length });
      res.json({ path: relativePath });
    } catch (err) {
      log.error("plugins", "updateSpreadsheet: threw", { pathPreview: previewSnippet(relativePath), error: errorMessage(err) });
      serverError(res, errorMessage(err));
    }
  },
);

// createMindMap — uses package execute for node layout computation
router.post(
  API_ROUTES.plugins.mindmap,
  wrapPluginExecute((req) => executeMindMap(null as never, req.body)),
);

// putQuestions — quiz
router.post(
  API_ROUTES.plugins.quiz,
  wrapPluginExecute((req) => executeQuiz(null as never, req.body)),
);

// presentForm — form
router.post(
  API_ROUTES.plugins.form,
  wrapPluginExecute((req) => executeForm(null as never, req.body)),
);

// 1×1 transparent PNG. Used as a placeholder so the canvas tool
// result can carry a stable file path from the moment the canvas
// is opened — client autosaves PUT-overwrite this same file, so the
// drawing survives page reload with zero client→server sync.
const BLANK_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

// openCanvas — drawing canvas
router.post(
  API_ROUTES.plugins.canvas,
  wrapPluginExecute(async () => {
    const imagePath = await saveImage(BLANK_PNG_BASE64);
    const base = await executeOpenCanvas(imagePath);
    return { ...base, data: { imageData: imagePath, prompt: "" } };
  }),
);

// present3d — 3D visualization
router.post(
  API_ROUTES.plugins.present3d,
  wrapPluginExecute((req) => executePresent3D(null as never, req.body)),
);

export default router;
