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
  const baseSegs = isAbsolute ? [] : basePath.split("/").filter((seg) => seg !== "" && seg !== ".");
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

// Extract the alt-text span `[...]` from an image ref `![alt](url...)`.
// CommonMark allows balanced nested brackets inside alt (`![x [y]](z)`),
// which a greedy regex would get wrong — scan with a depth counter and
// return the slice between the outermost brackets.
function extractBracketedAlt(raw: string): string | null {
  if (!raw.startsWith("![")) return null;
  let depth = 1;
  for (let i = 2; i < raw.length; i++) {
    const char = raw[i];
    if (char === "[") depth++;
    else if (char === "]") {
      depth--;
      if (depth === 0) return raw.slice(2, i);
    }
  }
  return null;
}

function rewriteImageToken(token: Tokens.Image, basePath: string): string | null {
  const href = (token.href ?? "").trim();
  if (href === "" || shouldSkip(href)) return null;
  const resolved = resolveWorkspacePath(basePath, href);
  if (resolved === null) return null;
  const newHref = resolveImageSrc(resolved);
  // Preserve alt text verbatim — read from the raw so any special
  // characters (brackets, entities) survive unmodified.
  const alt = extractBracketedAlt(token.raw) ?? token.text ?? "";
  if (token.title) {
    const escapedTitle = token.title.replace(/"/g, '\\"');
    return `![${alt}](${newHref} "${escapedTitle}")`;
  }
  return `![${alt}](${newHref})`;
}

function isSkippable(token: Token): boolean {
  return token.type === "code" || token.type === "codespan" || token.type === "html";
}

function getContainerChildren(token: Token): Token[] | null {
  const container = token as { tokens?: Token[]; items?: Token[] };
  if (Array.isArray(container.tokens) && container.tokens.length > 0) {
    return container.tokens;
  }
  if (Array.isArray(container.items) && container.items.length > 0) {
    return container.items;
  }
  return null;
}

// Render a container's children back into the output, preserving any
// structural glue the parent carries outside the children's combined
// raw span (list markers, blockquote prefixes, trailing newlines).
// Returns true if the container was rendered via its children, false
// if the caller should fall back to emitting the parent's raw.
function renderContainerChildren(raw: string, children: Token[], basePath: string, out: string[]): boolean {
  const joined = children.map((token) => (token as { raw?: string }).raw ?? "").join("");
  if (joined === "") return false;
  const idx = raw.indexOf(joined);
  if (idx < 0) return false;
  if (idx > 0) out.push(raw.slice(0, idx));
  for (const child of children) renderToken(child, basePath, out);
  const tail = raw.slice(idx + joined.length);
  if (tail) out.push(tail);
  return true;
}

// Recursively render a token back to markdown, rewriting image refs
// in-place. Code / codespan / html tokens are emitted verbatim so
// image-ref syntax inside them stays literal. Token-tree recursion
// uses the lexer's structural knowledge and never crosses a skip
// boundary — unlike the earlier `indexOf` splice which could rewrite
// a code-block literal when the same ref appeared in real markdown.
function renderToken(token: Token, basePath: string, out: string[]): void {
  if (isSkippable(token)) {
    out.push(token.raw);
    return;
  }
  if (token.type === "image") {
    const replacement = rewriteImageToken(token as Tokens.Image, basePath);
    out.push(replacement ?? token.raw);
    return;
  }
  const raw = (token as { raw?: string }).raw ?? "";
  const children = getContainerChildren(token);
  if (children && renderContainerChildren(raw, children, basePath, out)) {
    return;
  }
  out.push(raw);
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
export function rewriteMarkdownImageRefs(markdown: string, basePath = ""): string {
  const tokens = marked.lexer(markdown);
  const parts: string[] = [];
  for (const token of tokens) renderToken(token, basePath, parts);
  return parts.join("");
}
