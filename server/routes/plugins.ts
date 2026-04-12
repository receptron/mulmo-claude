import { Router, Request, Response } from "express";
import { executeMindMap } from "@gui-chat-plugin/mindmap";
import {
  executeSpreadsheet,
  type SpreadsheetArgs,
} from "../../src/plugins/spreadsheet/definition.js";
import { executeQuiz } from "@mulmochat-plugin/quiz";
import { executeForm } from "@mulmochat-plugin/form";
import { executeOpenCanvas } from "../../src/plugins/canvas/definition.js";
import { executePresent3D } from "@gui-chat-plugin/present3d";
import { showMusic } from "@gui-chat-plugin/music";
import {
  generateGeminiImageFromPrompt,
  isGeminiAvailable,
} from "../utils/gemini.js";
import { errorMessage } from "../utils/errors.js";
import { saveImage } from "../utils/image-store.js";
import {
  saveMarkdown,
  overwriteMarkdown,
  isMarkdownPath,
} from "../utils/markdown-store.js";
import {
  saveSpreadsheet,
  overwriteSpreadsheet,
  isSpreadsheetPath,
} from "../utils/spreadsheet-store.js";

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
): (
  req: Request<object, unknown, TBody>,
  res: Response<TResult | PluginErrorResponse>,
) => Promise<void> {
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
  } catch {
    // leave placeholder if generation fails
  }
  return null;
}

async function fillImagePlaceholders(markdown: string): Promise<string> {
  if (!isGeminiAvailable()) return markdown;
  const matches = [...markdown.matchAll(IMAGE_PLACEHOLDER)];
  if (matches.length === 0) return markdown;

  const results = await Promise.all(
    matches.map(async (m) => ({
      full: m[0],
      prompt: m[1],
      url: await generateImageFile(m[1]),
    })),
  );

  let filled = markdown;
  for (const { full, prompt, url } of results) {
    if (url) filled = filled.replace(full, `![${prompt}](../${url})`);
  }
  return filled;
}

// presentDocument — fills image placeholders via Gemini if API key is available
interface PresentDocumentBody {
  title: string;
  markdown: string;
  filenameHint?: string;
}

interface PresentDocumentResponse {
  message: string;
  title: string;
  data: { markdown: string; filenameHint?: string };
}

router.post(
  "/present-document",
  async (
    req: Request<object, unknown, PresentDocumentBody>,
    res: Response<PresentDocumentResponse>,
  ) => {
    const { title, markdown, filenameHint } = req.body;
    const filledMarkdown = await fillImagePlaceholders(markdown);
    const markdownPath = await saveMarkdown(filledMarkdown);
    res.json({
      message: `Document "${title}" is ready.`,
      title,
      data: { markdown: markdownPath, filenameHint },
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
  "/markdowns/:filename",
  async (
    req: Request<{ filename: string }, unknown, UpdateMarkdownBody>,
    res: Response<UpdateMarkdownResponse | UpdateMarkdownError>,
  ) => {
    const relativePath = `markdowns/${req.params.filename}`;
    const { markdown } = req.body;
    if (!markdown) {
      res.status(400).json({ error: "markdown is required" });
      return;
    }
    if (!isMarkdownPath(relativePath)) {
      res.status(400).json({ error: "invalid markdown path" });
      return;
    }
    try {
      await overwriteMarkdown(relativePath, markdown);
      res.json({ path: relativePath });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
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
  "/present-spreadsheet",
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
  "/spreadsheets/:filename",
  async (
    req: Request<{ filename: string }, unknown, UpdateSpreadsheetBody>,
    res: Response<UpdateSpreadsheetResponse | UpdateSpreadsheetError>,
  ) => {
    const relativePath = `spreadsheets/${req.params.filename}`;
    const { sheets } = req.body;
    if (!Array.isArray(sheets)) {
      res.status(400).json({ error: "sheets must be an array" });
      return;
    }
    if (!isSpreadsheetPath(relativePath)) {
      res.status(400).json({ error: "invalid spreadsheet path" });
      return;
    }
    try {
      await overwriteSpreadsheet(relativePath, sheets);
      res.json({ path: relativePath });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

// createMindMap — uses package execute for node layout computation
router.post(
  "/mindmap",
  wrapPluginExecute((req) => executeMindMap(null as never, req.body)),
);

// putQuestions — quiz
router.post(
  "/quiz",
  wrapPluginExecute((req) => executeQuiz(null as never, req.body)),
);

// presentForm — form
router.post(
  "/form",
  wrapPluginExecute((req) => executeForm(null as never, req.body)),
);

// openCanvas — drawing canvas
router.post(
  "/canvas",
  wrapPluginExecute(() => executeOpenCanvas()),
);

// present3d — 3D visualization
router.post(
  "/present3d",
  wrapPluginExecute((req) => executePresent3D(null as never, req.body)),
);

// showMusic — sheet music display
router.post(
  "/music",
  wrapPluginExecute((req) => showMusic(null as never, req.body)),
);

export default router;
