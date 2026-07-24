// POST markdown to a server endpoint that renders it and answers with a
// binary body (PDF via /api/pdf/markdown, self-contained HTML zip via
// /api/share/pack-markdown). Both take the same request shape.
//
// Only the request is shared: the raw `Response` comes back unchecked so
// each caller keeps its own failure contract — the PDF view surfaces the
// server's status and body text, the zip view raises a flag and renders a
// localized message instead of the raw body.

import { apiFetchRaw } from "./api";

export interface MarkdownRenderOptions {
  /** Workspace-relative source directory of the markdown (e.g.
   *  `"data/wiki/pages"` for Wiki pages). The server uses it to
   *  resolve relative `<img>` references to the right base path
   *  before inlining. Omit for the legacy `markdowns/` default. */
  baseDir?: string;
  /** When true, the server strips a leading YAML frontmatter envelope
   *  (`---\n…\n---\n`) before rendering, so the YAML header doesn't
   *  appear as plain text on page 1. Wiki pages set this. Other callers
   *  leave it false so a chat-generated document that literally starts
   *  with `---` is preserved. */
  stripFrontmatter?: boolean;
  /** When true, the server renders the markdown via Marp (slide deck,
   *  one slide per page, 16:9) instead of the default paged markdown
   *  layout. Caller sets this when the source has `marp: true` in its
   *  frontmatter. */
  marp?: boolean;
}

/** Rejects on network errors. Does NOT check `response.ok` — that branch
 *  belongs to the caller. */
export function postMarkdownForBlob(route: string, markdown: string, filename: string, options: MarkdownRenderOptions): Promise<Response> {
  const { baseDir, stripFrontmatter, marp } = options;
  return apiFetchRaw(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, filename, baseDir, stripFrontmatter, marp }),
  });
}
