import { Router, Request, Response } from "express";
import { executeMindMap } from "@gui-chat-plugin/mindmap";
import { executeSpreadsheet, type SpreadsheetArgs } from "../../../src/plugins/spreadsheet/definition.js";
import { executeQuiz } from "@mulmochat-plugin/quiz";
import { executeForm } from "../../../src/plugins/presentForm/plugin.js";
import { executePresentCollection } from "../../../src/plugins/presentCollection/plugin.js";
import type { PresentCollectionArgs } from "../../../src/plugins/presentCollection/types.js";
import { loadCollection, validateCollectionRecords } from "../../workspace/collections/index.js";
import { defangForPrompt } from "@mulmoclaude/core/collection";
import { executeOpenCanvas } from "../../../src/plugins/canvas/definition.js";
import { executePresent3D } from "@gui-chat-plugin/present3d";
import { executeMapControl } from "@gui-chat-plugin/google-map";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { saveImage } from "../../utils/files/image-store.js";
import { fillMarkdownImagePlaceholders } from "../../utils/files/markdown-image-fill.js";
import { saveMarkdown, overwriteMarkdown, isMarkdownPath } from "../../utils/files/markdown-store.js";
import { saveSpreadsheet, overwriteSpreadsheet, isSpreadsheetPath } from "../../utils/files/spreadsheet-store.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { bindRoute } from "../../utils/router.js";
import { collectPluginMetaDiagnostics } from "../../plugins/diagnostics.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { publishFileChange } from "../../events/file-change.js";
import { isAblated } from "../../system/env.js";

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

bindRoute(
  router,
  API_ROUTES.markdown.create,
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

bindRoute(
  router,
  API_ROUTES.markdown.update,
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
bindRoute(
  router,
  API_ROUTES.spreadsheet.create,
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

bindRoute(
  router,
  API_ROUTES.spreadsheet.update,
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
  wrapPluginExecute<Parameters<typeof executeMindMap>[1]>((req) => executeMindMap(null as never, req.body)),
);

// putQuestions — quiz
router.post(
  API_ROUTES.plugins.quiz,
  wrapPluginExecute<Parameters<typeof executeQuiz>[1]>((req) => executeQuiz(null as never, req.body)),
);

// presentForm — form
bindRoute(
  router,
  API_ROUTES.form.dispatch,
  wrapPluginExecute<Parameters<typeof executeForm>[1]>((req) => executeForm(null as never, req.body)),
);

// presentCollection — render a collection (or one item) as an inline,
// editable chat card. The View mounts CollectionView, which fetches +
// mutates live workspace state via the existing /api/collections routes.
//
// On top of the isomorphic executor we run a server-side validation pass:
// a malformed record is silently skipped at read time, so without this a
// bad file just vanishes. We append any problems to `instructions` (which
// the LLM reads) so the model — which is told to call presentCollection
// after every write — fixes the file instead of losing the record.
// `defangForPrompt` (shared with the client Repair button via
// `@mulmoclaude/core/collection`) strips markup / escape sequences, collapses
// whitespace, and clips — so record-controlled text in a validation issue (a
// filename, id, or enum value) can't be read as instructions once appended to
// the LLM-facing result.
async function dispatchPresentCollection(req: Request<object, unknown, PresentCollectionArgs>) {
  const result = await executePresentCollection(null as never, req.body);
  const slug = result.data?.collectionSlug;
  if (!slug) return result; // error result (no slug) — nothing to validate
  if (isAblated("validation")) return result; // evaluation-only: issue reporting ablated
  // Validation is best-effort: it must never turn a successful present into a
  // 500, so swallow its failures and just present without the warning.
  try {
    const collection = await loadCollection(slug);
    if (!collection) return result; // bad slug surfaces as the View's not-found state
    const issues = await validateCollectionRecords(collection);
    if (issues.length === 0) return result;
    log.warn("plugins", "presentCollection: record issues", { slug, count: issues.length });
    const lines = issues.map((issue) => `- ${defangForPrompt(issue.file)}: ${defangForPrompt(issue.problem)}`).join("\n");
    const warning = `\n\n⚠️ ${issues.length} record file(s) have data problems and may be missing from the view. Fix each (Read → correct → Write):\n${lines}`;
    return { ...result, instructions: `${result.instructions ?? ""}${warning}` };
  } catch (err) {
    log.warn("plugins", "presentCollection: validation skipped", { slug, error: errorMessage(err) });
    return result;
  }
}

bindRoute(router, API_ROUTES.presentCollection.dispatch, wrapPluginExecute(dispatchPresentCollection));

// 1×1 transparent PNG. Used as a placeholder so the canvas tool
// result can carry a stable file path from the moment the canvas
// is opened — client autosaves PUT-overwrite this same file, so the
// drawing survives page reload with zero client→server sync.
const BLANK_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

// openCanvas — drawing canvas
bindRoute(
  router,
  API_ROUTES.canvas.dispatch,
  wrapPluginExecute(async () => {
    const imagePath = await saveImage(BLANK_PNG_BASE64);
    const base = await executeOpenCanvas(imagePath);
    return { ...base, data: { imageData: imagePath, prompt: "" } };
  }),
);

// present3d — 3D visualization
router.post(
  API_ROUTES.plugins.present3d,
  wrapPluginExecute<Parameters<typeof executePresent3D>[1]>((req) => executePresent3D(null as never, req.body)),
);

// mapControl — Google Map (showLocation / Places / Directions etc.)
// from `@gui-chat-plugin/google-map`. The package's `executeMapControl`
// returns the action descriptor; the rendered View — mounted host-side
// from `App.vue` — performs the actual Google Maps JS calls and
// receives the API key as a prop sourced from `AppSettings`.
router.post(
  API_ROUTES.plugins.googleMap,
  wrapPluginExecute<Parameters<typeof executeMapControl>[1]>((req) => executeMapControl(null as never, req.body)),
);

// META aggregator diagnostics — boot-time host/plugin or plugin/plugin
// key collisions. The frontend fetches this once at mount so a tab
// that opens after the boot-time `publishNotification` fired still
// gets the warning. Empty array when clean.
router.get(API_ROUTES.plugins.diagnostics, (_req, res) => {
  res.json({ diagnostics: collectPluginMetaDiagnostics() });
});

export default router;
