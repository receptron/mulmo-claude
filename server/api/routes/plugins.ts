import path from "path";
import { Router, Request, Response } from "express";
import { executeMindMap } from "@gui-chat-plugin/mindmap";
import { executeSpreadsheet, type SpreadsheetArgs } from "../../../src/plugins/spreadsheet/definition.js";
import { executeQuiz } from "@mulmochat-plugin/quiz";
import { executeForm } from "@mulmochat-plugin/form";
import { executeOpenCanvas } from "../../../src/plugins/canvas/definition.js";
import { executePresent3D } from "@gui-chat-plugin/present3d";
import { generateGeminiImageFromPrompt, isGeminiAvailable } from "../../utils/gemini.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";
import { saveImage } from "../../utils/files/image-store.js";
import { saveMarkdown, overwriteMarkdown, isMarkdownPath } from "../../utils/files/markdown-store.js";
import { saveSpreadsheet, overwriteSpreadsheet, isSpreadsheetPath } from "../../utils/files/spreadsheet-store.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapPluginExecute<TBody = any, TResult = unknown>(
  execute: (req: Request<object, unknown, TBody>) => Promise<TResult>,
): (req: Request<object, unknown, TBody>, res: Response<TResult | PluginErrorResponse>) => Promise<void> {
  return async (req, res) => {
    try {
      const result = await execute(req);
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: errorMessage(err) });
    }
  };
}

const IMAGE_PLACEHOLDER = /!\[([^\]]+)\]\(\/?__too_be_replaced_image_path__\)/g;

async function generateImageFile(prompt: string): Promise<string | null> {
  if (!isGeminiAvailable()) return null;
  try {
    const { imageData } = await generateGeminiImageFromPrompt(prompt);
    if (imageData) return saveImage(imageData);
    log.warn("present-document", "Gemini returned no image data for prompt", {
      promptPreview: prompt.slice(0, 80),
    });
  } catch (err) {
    // Surface the failure so missing-image symptoms in the canvas
    // are debuggable from the server log instead of vanishing.
    log.warn("present-document", "Gemini image generation failed", {
      error: errorMessage(err),
      promptPreview: prompt.slice(0, 80),
    });
  }
  return null;
}

async function fillImagePlaceholders(markdown: string): Promise<string> {
  const matches = [...markdown.matchAll(IMAGE_PLACEHOLDER)];
  if (matches.length === 0) return markdown;
  // Only attempt generation when Gemini is wired up; otherwise the
  // placeholder still gets stripped below so we don't leak a broken
  // <img src="...__too_be_replaced_image_path__"> into the rendered
  // document.
  const geminiOk = isGeminiAvailable();
  if (!geminiOk) {
    log.warn("present-document", "GEMINI_API_KEY not set — image placeholders will render as text markers", { placeholderCount: matches.length });
  }

  const results = await Promise.all(
    matches.map(async (match) => ({
      full: match[0],
      prompt: match[1],
      url: geminiOk ? await generateImageFile(match[1]) : null,
    })),
  );

  // Surface a single tally line so the operator can see the
  // success rate even when most calls go through. The per-call
  // error already lands at warn from generateImageFile's catch.
  if (geminiOk) {
    const failed = results.filter((result) => !result.url).length;
    if (failed > 0) {
      log.warn("present-document", "image generation had failures", {
        failed,
        total: results.length,
      });
    }
  }

  let filled = markdown;
  for (const { full, prompt, url } of results) {
    // On success → real image. On failure / no key → italic text
    // marker so the alt prompt still surfaces but no broken image
    // 404s through the View. The user can re-render later once
    // GEMINI_API_KEY is set.
    filled = filled.replace(
      full,
      // `url` is workspace-relative (e.g. "artifacts/images/xxx.png").
      // The document lives at "artifacts/documents/yyy.md". Compute a
      // relative path from the document's directory so the markdown
      // image reference resolves correctly.
      url ? `![${prompt}](${path.posix.relative(WORKSPACE_DIRS.markdowns, url)})` : `*🖼️ Image: ${prompt}*`,
    );
  }
  return filled;
}

// presentDocument — fills image placeholders via Gemini if API key is available
interface PresentDocumentBody {
  title: string;
  markdown: string;
  filenamePrefix: string;
}

interface PresentDocumentSuccess {
  message: string;
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
    if (typeof filenamePrefix !== "string" || filenamePrefix.trim().length === 0) {
      badRequest(res, "filenamePrefix is required");
      return;
    }
    const filledMarkdown = await fillImagePlaceholders(markdown);
    const markdownPath = await saveMarkdown(filledMarkdown, filenamePrefix);
    res.json({
      message: `Document "${title}" is ready.`,
      title,
      data: { markdown: markdownPath, filenamePrefix },
    });
  },
);

// Update markdown file on disk (user edits in View)
interface UpdateMarkdownBody {
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
  async (req: Request<{ filename: string }, unknown, UpdateMarkdownBody>, res: Response<UpdateMarkdownResponse | UpdateMarkdownError>) => {
    const relativePath = `${WORKSPACE_DIRS.markdowns}/${req.params.filename}`;
    const { markdown } = req.body;
    if (!markdown) {
      badRequest(res, "markdown is required");
      return;
    }
    if (!isMarkdownPath(relativePath)) {
      badRequest(res, "invalid markdown path");
      return;
    }
    try {
      await overwriteMarkdown(relativePath, markdown);
      res.json({ path: relativePath });
    } catch (err) {
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

// Update spreadsheet file on disk (user edits in View)
interface UpdateSpreadsheetBody {
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
  async (req: Request<{ filename: string }, unknown, UpdateSpreadsheetBody>, res: Response<UpdateSpreadsheetResponse | UpdateSpreadsheetError>) => {
    const relativePath = `${WORKSPACE_DIRS.spreadsheets}/${req.params.filename}`;
    const { sheets } = req.body;
    if (!Array.isArray(sheets)) {
      badRequest(res, "sheets must be an array");
      return;
    }
    if (!isSpreadsheetPath(relativePath)) {
      badRequest(res, "invalid spreadsheet path");
      return;
    }
    try {
      await overwriteSpreadsheet(relativePath, sheets);
      res.json({ path: relativePath });
    } catch (err) {
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
    const base = await executeOpenCanvas();
    return { ...base, data: { imageData: imagePath, prompt: "" } };
  }),
);

// present3d — 3D visualization
router.post(
  API_ROUTES.plugins.present3d,
  wrapPluginExecute((req) => executePresent3D(null as never, req.body)),
);

export default router;
