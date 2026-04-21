// Markdown link rewriting utilities. Originally in
// workspace/journal/linkRewrite.ts; moved to utils/ so any module
// (journal, wiki, sources) can reuse them.
//
// All functions are pure — no filesystem access.

import path from "node:path";

/**
 * Rewrite every `[text](/workspace/path)` link in `content` to a
 * true-relative path computed from the given current-file location.
 * Non-workspace-absolute links (true relative, external URLs,
 * anchors) are left untouched.
 */
export function rewriteWorkspaceLinks(currentFileWsPath: string, content: string): string {
  const currentDir = path.posix.dirname(currentFileWsPath);
  return rewriteMarkdownLinks(content, (href) => {
    if (href.startsWith("//")) return href;
    if (!href.startsWith("/")) return href;
    const target = href.slice(1);
    if (target.length === 0) return href;
    const { pathPart, suffix } = splitFragmentAndQuery(target);
    const rel = path.posix.relative(currentDir, pathPart);
    const safeRel = rel.length > 0 ? rel : ".";
    return `${safeRel}${suffix}`;
  });
}

/**
 * Walk through `input` and invoke `rewrite` for every `[text](href)`
 * it encounters, substituting the returned href. Character-level scan
 * (no regex) to stay lint-clean.
 */
export function rewriteMarkdownLinks(input: string, rewrite: (href: string) => string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] !== "[") {
      parts.push(input[i]);
      i++;
      continue;
    }
    const closeBracket = input.indexOf("]", i + 1);
    if (closeBracket === -1) {
      parts.push(input.slice(i));
      break;
    }
    if (input[closeBracket + 1] !== "(") {
      parts.push(input.slice(i, closeBracket + 1));
      i = closeBracket + 1;
      continue;
    }
    const openParen = closeBracket + 1;
    const closeParen = input.indexOf(")", openParen + 1);
    if (closeParen === -1) {
      parts.push(input.slice(i));
      break;
    }
    const linkText = input.slice(i + 1, closeBracket);
    const href = input.slice(openParen + 1, closeParen);
    parts.push(`[${linkText}](${rewrite(href)})`);
    i = closeParen + 1;
  }
  return parts.join("");
}

/**
 * Split a trailing `#fragment` or `?query` off a path so the caller
 * can rewrite the path portion and concatenate the suffix back.
 */
export function splitFragmentAndQuery(s: string): {
  pathPart: string;
  suffix: string;
} {
  const hashIdx = s.indexOf("#");
  const queryIdx = s.indexOf("?");
  let cut = -1;
  if (hashIdx !== -1) cut = hashIdx;
  if (queryIdx !== -1 && (cut === -1 || queryIdx < cut)) cut = queryIdx;
  if (cut === -1) return { pathPart: s, suffix: "" };
  return { pathPart: s.slice(0, cut), suffix: s.slice(cut) };
}
