import { resolveImageSrc } from "./resolve";

// Pre-`marked` pass that rewrites workspace-relative image references
// in markdown source so they render through the backend file server.
//
// Without this, a page like `![chart](../images/foo.png)` produces
// `<img src="../images/foo.png">`, which the browser resolves against
// the SPA page URL (e.g. `/chat/…foo.png`) and 404s. After this
// pass, the src becomes `/api/files/raw?path=images/foo.png` which
// the workspace file server serves.
//
// Callers that know the markdown file's directory (`basePath`) get
// correct resolution for `./` and `../` relative refs. Callers that
// omit `basePath` only resolve refs that are already workspace-rooted
// (no leading `./` or `../`); relative-with-traversal refs without
// context would be ambiguous, so they pass through untouched rather
// than silently pointing at the wrong file.
//
// Used by:
//
//   - `src/plugins/wiki/View.vue`
//   - `src/components/FilesView.vue` (when previewing a .md file)
//   - `src/plugins/markdown/View.vue` (via post-`marked` HTML rewriter)

// Match `![alt](url)`. Single character class per span, no
// overlapping backtracking surface (linear-time matching).
const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^)]*)\)/g;

function shouldSkip(url: string): boolean {
  if (url.startsWith("data:")) return true;
  if (url.startsWith("http://") || url.startsWith("https://")) return true;
  // Already an API route — nothing to do.
  if (url.startsWith("/api/")) return true;
  return false;
}

/**
 * Resolve `url` relative to `basePath` using posix segment arithmetic.
 * Returns the resolved workspace-relative path, or `null` if the URL
 * escapes the workspace root (more `..` than `basePath` depth).
 *
 * Pure string operation — does not touch the filesystem or use Node's
 * `path` module (this file runs in the browser).
 */
function resolveWorkspacePath(basePath: string, url: string): string | null {
  // Absolute-within-workspace (e.g. "/images/foo.png") — reset base.
  const isAbsolute = url.startsWith("/");
  const baseSegs = isAbsolute
    ? []
    : basePath.split("/").filter((s) => s !== "" && s !== ".");
  const segs = [...baseSegs];

  const urlSegs = (isAbsolute ? url.slice(1) : url).split("/");
  for (const seg of urlSegs) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (segs.length === 0) return null;
      segs.pop();
      continue;
    }
    segs.push(seg);
  }
  if (segs.length === 0) return null;
  return segs.join("/");
}

/**
 * Rewrite `![alt](path)` image refs in markdown text so workspace-
 * relative paths render through `/api/files/raw`.
 *
 * @param markdown Markdown source text.
 * @param basePath The workspace-relative directory of the markdown
 *   file (e.g. `"wiki/pages"` for `wiki/pages/foo.md`). Omit or pass
 *   `""` when resolving refs against the workspace root.
 *
 * Absolute URLs, data URIs, and existing API paths pass through
 * untouched. Refs that would escape the workspace root (more `..`
 * than `basePath` depth) also pass through untouched — they would
 * 404 regardless, and passing through lets the user see the broken
 * ref instead of silently re-pointing it.
 */
export function rewriteMarkdownImageRefs(
  markdown: string,
  basePath: string = "",
): string {
  return markdown.replace(IMAGE_REF_RE, (match, alt: string, url: string) => {
    const trimmedUrl = url.trim();
    if (trimmedUrl === "" || shouldSkip(trimmedUrl)) return match;
    const resolved = resolveWorkspacePath(basePath, trimmedUrl);
    if (resolved === null) return match;
    return `![${alt}](${resolveImageSrc(resolved)})`;
  });
}
