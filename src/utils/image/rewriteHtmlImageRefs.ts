import { resolveImageSrc } from "./resolve";

// Rewrite `<img src="…">` references in raw HTML so workspace-relative
// paths are routed through `/api/files/raw`. Counterpart to
// `rewriteMarkdownImageRefs` for the case where the LLM emits a full
// HTML document (presentHtml plugin) rather than markdown.
//
// Why this is needed:
//   - The LLM tends to emit `<img src="/artifacts/images/…">` using the
//     web convention where leading `/` means "site root".
//   - presentHtml renders the document inside an `<iframe srcdoc>`
//     under the SPA origin, so the browser tries to fetch
//     `http://localhost:5173/artifacts/…` — Express does not serve
//     that path, so the request 404s and the image breaks.
//   - Rewriting the src to `/api/files/raw?path=artifacts/…` routes
//     it through the workspace file server.
//
// Skipped (returned untouched):
//   - `data:` URIs (already inline)
//   - `http://` / `https://` URLs (external)
//   - Existing `/api/…` paths (already correct)
//
// The regex matches double-quoted `src` attributes only (the form the
// LLM consistently emits). Single-quoted variants are intentionally
// left alone — extend later if a real case appears.

const IMG_SRC_RE = /(<img\s[^>]*src=")([^"]+)(")/g;

function shouldSkip(src: string): boolean {
  if (src.startsWith("data:")) return true;
  if (src.startsWith("http://") || src.startsWith("https://")) return true;
  if (src.startsWith("/api/")) return true;
  return false;
}

// Strip the optional leading slash to convert a "web-rooted" path to a
// workspace-relative one. `/artifacts/foo.png` → `artifacts/foo.png`,
// `artifacts/foo.png` → `artifacts/foo.png`.
function normalizeWorkspacePath(src: string): string {
  return src.startsWith("/") ? src.slice(1) : src;
}

export function rewriteHtmlImageRefs(html: string): string {
  return html.replace(IMG_SRC_RE, (match, before: string, src: string, after: string) => {
    if (shouldSkip(src)) return match;
    const workspacePath = normalizeWorkspacePath(src);
    if (workspacePath.length === 0) return match;
    return `${before}${resolveImageSrc(workspacePath)}${after}`;
  });
}
