import { realpathSync } from "fs";
import path from "path";
import { Router, Request, Response } from "express";
import { marked } from "marked";
import puppeteer from "puppeteer";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { resolveWithinRoot, readBinarySafeSync } from "../../utils/files/safe.js";
import { resolveWorkspacePath } from "../../utils/files/workspace-io.js";
import { parseFrontmatter } from "../../utils/markdown/frontmatter.js";
import { log } from "../../system/logger/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { transformResolvableUrlsInHtml } from "../../../src/utils/image/htmlSrcAttrs.js";

const router = Router();

const MARKDOWN_CSS = `
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    color: #1f2937;
    max-width: 800px;
    margin: 0 auto;
    padding: 32px 48px;
  }
  h1 { font-size: 1.75rem; font-weight: 700; margin: 0 0 0.75rem; color: #111827; }
  h2 { font-size: 1.25rem; font-weight: 600; margin: 1.5rem 0 0.5rem; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25rem; }
  h3 { font-size: 1rem; font-weight: 600; margin: 1rem 0 0.4rem; color: #374151; }
  p { margin: 0 0 0.75rem; }
  ul, ol { margin: 0 0 0.75rem 1.5rem; }
  li { margin-bottom: 0.2rem; }
  ul { list-style-type: disc; }
  ol { list-style-type: decimal; }
  code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 0.25rem; font-size: 0.85em; font-family: monospace; }
  pre { background: #f3f4f6; padding: 0.75rem; border-radius: 0.375rem; overflow-x: auto; margin: 0 0 0.75rem; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d1d5db; padding-left: 1rem; color: #6b7280; margin: 0.75rem 0; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.25rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 0.75rem; font-size: 0.875rem; }
  th, td { border: 1px solid #e5e7eb; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #f9fafb; font-weight: 600; }
  strong { font-weight: 600; }
  a { color: #2563eb; }
  img { max-width: 100%; height: auto; }
`;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

// Realpath of the workspace, resolved once at module load. Used to
// validate that image paths resolved relative to markdowns/ stay
// inside the workspace after symlink resolution.
const defaultWorkspaceRoot = realpathSync(resolveWorkspacePath(""));

export interface InlineImagesOptions {
  /** Workspace root absolute path. Defaults to the lazily-resolved
   *  realpath of the configured workspace. */
  workspaceRoot?: string;
  /** Workspace-relative directory the markdown source lives in,
   *  used to resolve `../foo.png`-style references. e.g.
   *  `"data/wiki/pages"` for Wiki page PDFs. Defaults to
   *  `WORKSPACE_DIRS.markdowns` for legacy callers. Inputs are
   *  rejected if they're absolute or contain `..` segments — the
   *  workspace boundary is enforced anyway by `resolveWithinRoot`,
   *  but rejecting up-front gives a clearer log line than a
   *  silently-broken image. */
  sourceDir?: string;
}

// Tag scanning + attribute iteration live in the shared helper
// (`src/utils/image/htmlSrcAttrs.ts`) so the Markdown surface
// (`rewriteImgSrcAttrsInHtml`) and this PDF surface stay in lockstep.
// Adding a tag / attribute (Stage B's `<source>` / `<video poster>`
// / `<audio src>`) updates both surfaces with one diff (#1011 Stage B).

function isSafeSourceDir(dir: string): boolean {
  if (!dir) return true;
  if (path.isAbsolute(dir)) return false;
  return !dir.split(/[/\\]/).some((segment) => segment === "..");
}

// Resolve a workspace-rooted-or-relative `src` value to an absolute
// path on disk, validated to stay inside the workspace root. Returns
// null on any failure (escape attempt, missing file, malformed path).
// Logs the reason so the developer can grep when a PDF image is
// missing.
function resolveImageAbsPath(src: string, workspaceRoot: string, baseDir: string): string | null {
  // Strip query / fragment before any filesystem-level resolution —
  // a `<img src="foo.png?v=123">` cache-bust must still find the
  // file at `foo.png` on disk. Without this strip, `path.resolve`
  // bakes the `?v=123` into the candidate path and the safe-resolve
  // / readBinarySafeSync reject (codex review iter-2 #1028).
  const pathPart = urlPathname(src);
  // LLM-generated HTML often emits leading-slash workspace-rooted
  // paths like "/artifacts/images/2026/04/foo.png" (web convention).
  // Treat those as workspace-relative; otherwise path.resolve below
  // sees the slash as host-absolute and the safe-resolve rejects.
  const workspaceRooted = pathPart.startsWith("/");
  const resolveBase = workspaceRooted ? workspaceRoot : baseDir;
  const relSrc = workspaceRooted ? pathPart.slice(1) : pathPart;
  const unsafeAbs = path.resolve(resolveBase, relSrc);
  const relToWorkspace = path.relative(workspaceRoot, unsafeAbs);
  if (relToWorkspace.startsWith("..") || path.isAbsolute(relToWorkspace)) {
    log.warn("pdf", "image path escapes workspace", { src });
    return null;
  }
  const abs = resolveWithinRoot(workspaceRoot, relToWorkspace);
  if (!abs) {
    log.warn("pdf", "image path rejected by safe-resolve", { src });
    return null;
  }
  return abs;
}

function loadImageAsDataUri(abs: string): string | null {
  const buf = readBinarySafeSync(abs);
  if (!buf) {
    log.warn("pdf", "could not read image", { abs });
    return null;
  }
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Video / audio extensions Stage B (#1011) added to the rewriter.
// In PDF rendering puppeteer can't play them, so inlining a large
// `.mp4` as base64 just blows up the HTML and times out the page
// load (`Navigation timeout of 30000 ms exceeded`). The `<video
// poster>` attribute IS an image and stays inlined — that's the
// only thing the user actually sees in a PDF anyway. The `<video
// src>` / `<source src>` (in a `<video>`) / `<audio src>` URL is
// left as the original relative path; puppeteer's fetch will fail
// quickly and `networkidle0` still resolves.
//
// Anchored at end-of-pathname (callers strip query / fragment first
// via `urlPathname` below) so a query-string-only mention of the
// extension doesn't false-positive — e.g. `foo.png?clip.mp4` must
// inline the PNG, not be treated as an mp4 (codex review iter-1).
const PDF_SKIP_MEDIA_EXT_RE = /\.(mp4|webm|mov|m4v|ogv|mp3|ogg|oga|wav|m4a|aac)$/i;

function urlPathname(url: string): string {
  const queryStart = url.indexOf("?");
  const fragStart = url.indexOf("#");
  const limit = [queryStart, fragStart].filter((idx) => idx >= 0).reduce((min, idx) => Math.min(min, idx), url.length);
  return url.slice(0, limit);
}

/** Whether a URL points at a video / audio file that should NOT be
 *  base64-inlined into a PDF. Exported for direct unit testing —
 *  filesystem-level resolver checks (`resolveImageAbsPath`) can mask
 *  the regex's behaviour because a missing file also returns null,
 *  so the in-line callback's output looks identical for "skip" vs
 *  "resolve-failed". */
export function shouldSkipMediaForPdf(url: string): boolean {
  return PDF_SKIP_MEDIA_EXT_RE.test(urlPathname(url));
}

/**
 * Inline local images as base64 data URIs so Puppeteer can render
 * them. Resolves URL-bearing attributes (currently `<img src>`,
 * `<source src>`, `<video poster|src>`, `<audio src>`) against
 * `sourceDir` (workspace-relative); for example, a Wiki page
 * (`data/wiki/pages/X.md`) referencing
 * `../../../artifacts/images/foo.png` resolves to
 * `artifacts/images/foo.png`.
 *
 * Handles double-quoted, single-quoted, and unquoted values. Skips
 * `data:` URIs and `http(s)` URLs. Refuses values that escape the
 * workspace root after resolution — the workspace boundary is
 * enforced by `resolveWithinRoot`, regardless of `sourceDir`.
 *
 * Tag + attribute coverage is shared with the browser markdown
 * surface (`rewriteImgSrcAttrsInHtml`) via `RESOLVABLE_TAG_ATTRS` in
 * `src/utils/image/htmlSrcAttrs.ts`.
 */
export function inlineImages(html: string, options: InlineImagesOptions = {}): string {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot;
  // Defensive type guard: a malformed request body could send
  // `baseDir: null` / `baseDir: 42` / etc. Coerce anything non-
  // string to undefined so the legacy default kicks in instead of
  // `path.join` throwing on a non-string.
  const requestedDir = typeof options.sourceDir === "string" ? options.sourceDir : undefined;
  // Distinguish "explicitly empty" (= workspace root, e.g. a top-
  // level `README.md`) from "absent" (= legacy `markdowns/` default
  // for chat callers). Without this, the `||` collapse would route
  // every workspace-root file through the legacy default.
  const hasRequestedDir = requestedDir !== undefined;
  const dirIsSafe = !hasRequestedDir || isSafeSourceDir(requestedDir);
  if (hasRequestedDir && !dirIsSafe) {
    log.warn("pdf", "rejecting unsafe sourceDir, falling back to default", { sourceDir: requestedDir });
  }
  const sourceDir = dirIsSafe && hasRequestedDir ? requestedDir : WORKSPACE_DIRS.markdowns;
  const baseDir = path.join(workspaceRoot, sourceDir);
  return transformResolvableUrlsInHtml(html, (url) => {
    // Narrow to exact `http://` / `https://` prefixes so a relative
    // path like `http-assets/logo.png` isn't misclassified as
    // external (CR follow-up on #1023).
    if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) return null;
    // Skip media (mp4 / mp3 / webm / ...) — see PDF_SKIP_MEDIA_EXT_RE
    // comment. `<video poster="x.png">` still inlines because the
    // poster value's pathname ends in an image extension. The
    // pathname slice means `foo.png?cacheBust=clip.mp4` correctly
    // routes through the PNG inline path (codex iter-1).
    if (shouldSkipMediaForPdf(url)) return null;
    const abs = resolveImageAbsPath(url, workspaceRoot, baseDir);
    if (!abs) return null;
    return loadImageAsDataUri(abs);
  });
}

function wrapHtml(body: string, css: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

async function renderPdf(fullHtml: string, format: "Letter" | "A4" = "Letter"): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format,
      margin: { top: "16mm", bottom: "16mm", left: "16mm", right: "16mm" },
      printBackground: true,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

function sendPdf(res: Response, buffer: Buffer, filename: string): void {
  const safeFilename = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
  res.send(buffer);
}

interface PdfMarkdownBody {
  markdown: string;
  filename?: string;
  format?: "Letter" | "A4";
  /** Workspace-relative source directory of the markdown (e.g.
   *  `"data/wiki/pages"` for Wiki pages). Used to resolve relative
   *  `<img>` references against the right base. Omit for the legacy
   *  `markdowns/` default. Validated server-side; absolute paths
   *  and `..` segments are rejected. */
  baseDir?: string;
  /** When true, strip a leading YAML frontmatter envelope before
   *  rendering so `title:` / `tags:` etc don't appear as plain text
   *  on page 1 of the PDF. Wiki pages use this. Markdown / Text
   *  Response callers omit (default false) so a chat-generated
   *  document that *literally* starts with `---\n…\n---\n` is
   *  preserved verbatim. */
  stripFrontmatter?: boolean;
}

router.post(API_ROUTES.pdf.markdown, async (req: Request<object, unknown, PdfMarkdownBody>, res: Response) => {
  const { body } = req;
  // Express only sets `req.body` after `express.json()` parses a JSON
  // payload. A client that sends raw JSON `null`, an array, or omits
  // the body entirely would land here with body = null / [] / undefined,
  // and the per-field guards below would throw on the first property
  // dereference. Bail out cleanly with a 400 instead.
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    badRequest(res, "request body must be a JSON object");
    return;
  }
  // Defensive type guards: a malformed JSON body could send
  // `baseDir: null` / `stripFrontmatter: "yes"` / etc. Coerce
  // anything off-shape to its safe default rather than letting a
  // downstream `path.join` / boolean check throw.
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  const filename = typeof body.filename === "string" ? body.filename : "document.pdf";
  const format: "Letter" | "A4" = body.format === "A4" ? "A4" : "Letter";
  const baseDir = typeof body.baseDir === "string" ? body.baseDir : undefined;
  const stripFrontmatter = body.stripFrontmatter === true;

  if (!markdown) {
    badRequest(res, "markdown is required");
    return;
  }

  try {
    log.info("pdf", "markdown", { filename, length: markdown.length, baseDir, stripFrontmatter });
    const source = stripFrontmatter ? parseFrontmatter(markdown).body : markdown;
    const html = inlineImages(await marked.parse(source), { sourceDir: baseDir });
    const buffer = await renderPdf(wrapHtml(html, MARKDOWN_CSS), format);
    sendPdf(res, buffer, filename);
  } catch (err) {
    log.error("pdf", "generation failed", { error: String(err) });
    serverError(res, `PDF generation failed: ${errorMessage(err)}`);
  }
});

export default router;
