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

// Outer regex: scan an `<img>` tag, respecting quoted attribute values
// so `>` characters that appear inside `alt="x > y"` don't terminate
// the tag prematurely (Codex iter-2 finding). The body is one of:
//   - any non-`>` non-quote char     `[^>"']`
//   - a complete double-quoted span  `"[^"]*"`
//   - a complete single-quoted span  `'[^']*'`
// All branches are bounded — no nested quantifiers, no overlap. The
// 100KB ReDoS test pins linear time.
//
// eslint-disable-next-line sonarjs/slow-regex, sonarjs/regex-complexity -- bounded alternatives, ReDoS-safe (test in test_pdfInlineImages.ts)
const IMG_TAG_RE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*\/?>/gi;
// Attribute iterator: walks each `name=value` pair inside a tag. The
// leading `\s+` ensures we only match real attribute boundaries, not
// `src=` text embedded inside another attribute's quoted value (e.g.
// `<img alt="x src=oops" src="real.png">` — the alt-internal `src=`
// has no whitespace prefix from the regex's POV because we parse
// attribute-by-attribute, never against the free-form tag body).
// Namespaced attrs (`xml:src`, `xlink:src`) match as their full name
// and are filtered below by `name.toLowerCase() !== "src"`.
// Capture groups:
//   1: leading whitespace
//   2: attribute name
//   3: `=` with surrounding spaces (only when value present)
//   4: full quoted/unquoted value
//   5: double-quoted value (without quotes)
//   6: single-quoted value (without quotes)
//   7: unquoted value — refuses leading `"` / `'` so a malformed
//      `<img src="aaaa` (no closing quote) doesn't capture the stray
//      quote as the value
//
// Why the disables: this regex has 3 alternation branches plus an
// optional value group, which trips sonarjs/regex-complexity (rule
// counts disjunctions). All quantifiers are bounded by `\s` or
// character-class negations — verified ReDoS-safe by the 100KB test
// (`test_pdfInlineImages.ts`). Refactoring to multiple passes would
// be slower and harder to read.
// eslint-disable-next-line sonarjs/slow-regex, sonarjs/regex-complexity -- bounded quantifiers, ReDoS-safe (test in test_pdfInlineImages.ts)
const IMG_ATTR_RE = /(\s+)([A-Za-z][\w:-]*)(?:(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>"'][^\s>]*)))?/g;

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
  // LLM-generated HTML often emits leading-slash workspace-rooted
  // paths like "/artifacts/images/2026/04/foo.png" (web convention).
  // Treat those as workspace-relative; otherwise path.resolve below
  // sees the slash as host-absolute and the safe-resolve rejects.
  const workspaceRooted = src.startsWith("/");
  const resolveBase = workspaceRooted ? workspaceRoot : baseDir;
  const relSrc = workspaceRooted ? src.slice(1) : src;
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

interface SrcAttrMatch {
  /** The portion of the matched attribute that we keep verbatim:
   *  leading whitespace + attribute name + `=` (with surrounding
   *  spaces). Only the value part is replaced. */
  prefix: string;
  doubleQuoted?: string;
  singleQuoted?: string;
  bare?: string;
  full: string;
}

function inlineSingleImg(match: SrcAttrMatch, workspaceRoot: string, baseDir: string): string {
  const src = (match.doubleQuoted ?? match.singleQuoted ?? match.bare ?? "").trim();
  if (!src) return match.full;
  // Skip URLs the browser fetches directly. Narrow to exact
  // `http://` / `https://` prefixes so a relative path like
  // `http-assets/logo.png` isn't misclassified as external (CR on #1023).
  if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) return match.full;
  const abs = resolveImageAbsPath(src, workspaceRoot, baseDir);
  if (!abs) return match.full;
  const dataUri = loadImageAsDataUri(abs);
  if (!dataUri) return match.full;
  const quote = match.doubleQuoted !== undefined ? '"' : match.singleQuoted !== undefined ? "'" : '"';
  return `${match.prefix}${quote}${dataUri}${quote}`;
}

/**
 * Inline local images as base64 data URIs so Puppeteer can render them.
 * Resolves `<img>` `src` references against `sourceDir` (workspace-
 * relative); for example, a Wiki page (`data/wiki/pages/X.md`)
 * referencing `../../../artifacts/images/foo.png` resolves to
 * `artifacts/images/foo.png`.
 *
 * Handles double-quoted, single-quoted, and unquoted `src` values.
 * Skips data: URIs and http(s) URLs. Refuses values that escape the
 * workspace root after resolution — the workspace boundary is
 * enforced by `resolveWithinRoot`, regardless of `sourceDir`.
 */
export function inlineImages(html: string, options: InlineImagesOptions = {}): string {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot;
  const requestedDir = options.sourceDir;
  const dirIsSafe = !requestedDir || isSafeSourceDir(requestedDir);
  if (requestedDir && !dirIsSafe) {
    log.warn("pdf", "rejecting unsafe sourceDir, falling back to default", { sourceDir: requestedDir });
  }
  const sourceDir = dirIsSafe && requestedDir ? requestedDir : WORKSPACE_DIRS.markdowns;
  const baseDir = path.join(workspaceRoot, sourceDir);
  return html.replace(IMG_TAG_RE, (tag) =>
    // Walk each attribute. Only `src` (case-insensitive, namespaced
    // attrs like `xml:src` / `xlink:src` filtered out) gets the
    // value rewritten. Other attributes — and `src=`-shaped text
    // inside their quoted values — are preserved verbatim because
    // we parse attribute-by-attribute, not by free-form regex.
    tag.replace(IMG_ATTR_RE, (...captures: unknown[]) => replaceSrcAttr(captures, workspaceRoot, baseDir)),
  );
}

function replaceSrcAttr(captures: unknown[], workspaceRoot: string, baseDir: string): string {
  const [full, leading, name, eqWithSpaces, , doubleQuoted, singleQuoted, bare] = captures as [
    string,
    string,
    string,
    string | undefined,
    string | undefined,
    string | undefined,
    string | undefined,
    string | undefined,
  ];
  if (!eqWithSpaces || name.toLowerCase() !== "src") return full;
  const prefix = `${leading}${name}${eqWithSpaces}`;
  return inlineSingleImg({ prefix, doubleQuoted, singleQuoted, bare, full }, workspaceRoot, baseDir);
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
  const { markdown, filename = "document.pdf", format = "Letter", baseDir, stripFrontmatter = false } = req.body;

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
