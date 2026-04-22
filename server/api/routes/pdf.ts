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
const workspaceReal = realpathSync(resolveWorkspacePath(""));

/**
 * Inline local images as base64 data URIs so Puppeteer can render them.
 * Markdown files live in workspace/artifacts/documents/ and reference
 * images as "../images/xyz.png" → workspace/artifacts/images/xyz.png.
 *
 * Paths are validated against the workspace root via resolveWithinRoot
 * so an attacker-controlled <img src="../../../etc/passwd"> can't read
 * files outside the workspace.
 */
function inlineImages(html: string): string {
  const baseDir = path.join(workspaceReal, WORKSPACE_DIRS.markdowns);
  return html.replace(/(<img\s[^>]*src=")([^"]+)(")/g, (_match, before: string, src: string, after: string) => {
    if (src.startsWith("data:") || src.startsWith("http")) {
      return _match;
    }
    // Resolve the image path relative to markdowns/ but require the
    // final realpath to stay inside the workspace root. markdowns/
    // references like "../images/foo.png" are common so we can't
    // restrict to markdowns/ itself.
    const unsafeAbs = path.resolve(baseDir, src);
    // Make unsafeAbs relative to the workspace for the
    // resolveWithinRoot check (it expects a relative path).
    const relToWorkspace = path.relative(workspaceReal, unsafeAbs);
    if (relToWorkspace.startsWith("..") || path.isAbsolute(relToWorkspace)) {
      log.warn("pdf", "image path escapes workspace", { src });
      return _match;
    }
    const abs = resolveWithinRoot(workspaceReal, relToWorkspace);
    if (!abs) {
      log.warn("pdf", "image path rejected by safe-resolve", { src });
      return _match;
    }
    const buf = readBinarySafeSync(abs);
    if (!buf) {
      log.warn("pdf", "could not read image", { abs });
      return _match;
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    return `${before}data:${mime};base64,${buf.toString("base64")}${after}`;
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
}

router.post(API_ROUTES.pdf.markdown, async (req: Request<object, unknown, PdfMarkdownBody>, res: Response) => {
  const { markdown, filename = "document.pdf", format = "Letter" } = req.body;

  if (!markdown) {
    badRequest(res, "markdown is required");
    return;
  }

  try {
    log.info("pdf", "markdown", { filename, length: markdown.length });
    const html = inlineImages(await marked.parse(markdown));
    const buffer = await renderPdf(wrapHtml(html, MARKDOWN_CSS), format);
    sendPdf(res, buffer, filename);
  } catch (err) {
    log.error("pdf", "generation failed", { error: String(err) });
    serverError(res, `PDF generation failed: ${errorMessage(err)}`);
  }
});

export default router;
