import { marked } from "marked";
import type { Token, Tokens } from "marked";
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
// Uses marked's tokenizer to find image refs rather than a raw regex
// over the source. The regex approach had two problems:
//   - URLs containing `)` (e.g. `Foo_(bar).png`) were truncated at
//     the first close paren.
//   - `![x](y)` inside fenced code blocks or inline code spans was
//     rewritten even though it's not meant to render as an image.
// The lexer handles both correctly.
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

interface Replacement {
  raw: string;
  replacement: string;
}

function rewriteImageToken(
  token: Tokens.Image,
  basePath: string,
): string | null {
  const href = (token.href ?? "").trim();
  if (href === "" || shouldSkip(href)) return null;
  const resolved = resolveWorkspacePath(basePath, href);
  if (resolved === null) return null;
  const newHref = resolveImageSrc(resolved);
  // Preserve alt text verbatim — read from the raw so any special
  // characters (brackets, entities) survive unmodified.
  const m = token.raw.match(/^!\[([^\]]*)\]/);
  const alt = m ? m[1] : (token.text ?? "");
  if (token.title) {
    const escapedTitle = token.title.replace(/"/g, '\\"');
    return `![${alt}](${newHref} "${escapedTitle}")`;
  }
  return `![${alt}](${newHref})`;
}

function collectImageReplacements(
  tokens: Token[],
  basePath: string,
  out: Replacement[],
): void {
  for (const token of tokens) {
    // Don't descend into code — `![x](y)` inside a fenced block or
    // backtick span is literal, not an image.
    if (
      token.type === "code" ||
      token.type === "codespan" ||
      token.type === "html"
    ) {
      continue;
    }
    if (token.type === "image") {
      const replacement = rewriteImageToken(token as Tokens.Image, basePath);
      if (replacement !== null) {
        out.push({ raw: token.raw, replacement });
      }
      continue;
    }
    // Container tokens carry children in `.tokens` (paragraph, heading,
    // blockquote, em, strong, …) or `.items` (list → list_item[]).
    const container = token as { tokens?: Token[]; items?: Token[] };
    if (Array.isArray(container.tokens)) {
      collectImageReplacements(container.tokens, basePath, out);
    }
    if (Array.isArray(container.items)) {
      collectImageReplacements(container.items, basePath, out);
    }
  }
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
 * ref instead of silently re-pointing it. Image-ref syntax inside
 * code blocks / inline code spans is left alone.
 */
export function rewriteMarkdownImageRefs(
  markdown: string,
  basePath: string = "",
): string {
  const tokens = marked.lexer(markdown);
  const replacements: Replacement[] = [];
  collectImageReplacements(tokens, basePath, replacements);
  if (replacements.length === 0) return markdown;

  // Apply replacements in document order. `indexOf` forward from the
  // cursor is safe across duplicate raws: marked enumerates tokens in
  // source order, so the next occurrence we want is always at-or-after
  // the cursor.
  let cursor = 0;
  const parts: string[] = [];
  for (const { raw, replacement } of replacements) {
    const idx = markdown.indexOf(raw, cursor);
    if (idx < 0) continue;
    parts.push(markdown.slice(cursor, idx), replacement);
    cursor = idx + raw.length;
  }
  parts.push(markdown.slice(cursor));
  return parts.join("");
}
