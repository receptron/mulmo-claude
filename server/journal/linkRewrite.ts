// Post-processing for archivist output: the archivist is instructed
// to emit workspace-absolute links like [wiki](/wiki/pages/foo.md),
// and we rewrite those to true-relative paths before writing the
// file to disk. That keeps the archivist's prompt simple (one rule:
// paths start with "/") and keeps the on-disk files viewable in any
// standard markdown renderer (because true-relative paths work).
//
// Both helpers are pure functions — no filesystem access — so the
// full logic is unit-testable.

import path from "node:path";

// Rewrite every `[text](/workspace/path)` link in `content` to a
// true-relative path computed from the given current-file location.
// Non-workspace-absolute links (true relative, external URLs,
// anchors) are left untouched.
export function rewriteWorkspaceLinks(
  currentFileWsPath: string,
  content: string,
): string {
  const currentDir = path.posix.dirname(currentFileWsPath);
  return rewriteMarkdownLinks(content, (href) => {
    // Leave protocol-relative URLs (//example.com) alone.
    if (href.startsWith("//")) return href;
    // Only rewrite hrefs that start with a single "/"
    if (!href.startsWith("/")) return href;
    const target = href.slice(1);
    if (target.length === 0) return href;
    // Split off optional #fragment / ?query so we only rewrite the
    // path portion. Files in the workspace don't use queries, but
    // fragments to scroll to a heading are fair game.
    const { pathPart, suffix } = splitFragmentAndQuery(target);
    const rel = path.posix.relative(currentDir, pathPart);
    // If the target happens to be the current file itself, emit "."
    // rather than an empty string so the link stays syntactically
    // valid markdown.
    const safeRel = rel.length > 0 ? rel : ".";
    return `${safeRel}${suffix}`;
  });
}

// Low-level rewriter: walks through `input` and invokes `rewrite`
// for every `[text](href)` it encounters, substituting the returned
// href. Implemented with a character-level scan (no regex) so
// sonarjs/slow-regex is happy and nested-paren heuristics don't
// misfire.
//
// Exported so other journal modules (optimization pass, index
// builder) can reuse it if they ever need link rewriting.
export function rewriteMarkdownLinks(
  input: string,
  rewrite: (href: string) => string,
): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    if (input[i] !== "[") {
      out += input[i];
      i++;
      continue;
    }
    // Found "[". Scan for the matching "]". We intentionally don't
    // support nested brackets in link text — archivist-generated
    // content doesn't use them and supporting nesting would require
    // full markdown parsing.
    const closeBracket = input.indexOf("]", i + 1);
    if (closeBracket === -1) {
      // Unterminated "[" — copy the rest verbatim and bail.
      out += input.slice(i);
      break;
    }
    // A valid markdown link requires "(" immediately after "]".
    if (input[closeBracket + 1] !== "(") {
      out += input.slice(i, closeBracket + 1);
      i = closeBracket + 1;
      continue;
    }
    const openParen = closeBracket + 1;
    const closeParen = input.indexOf(")", openParen + 1);
    if (closeParen === -1) {
      out += input.slice(i);
      break;
    }
    const linkText = input.slice(i + 1, closeBracket);
    const href = input.slice(openParen + 1, closeParen);
    out += `[${linkText}](${rewrite(href)})`;
    i = closeParen + 1;
  }
  return out;
}

// Pull a trailing "#fragment" or "?query" off a path. Returned as
// `{ pathPart, suffix }` so the caller can concatenate the suffix
// back onto a rewritten path.
function splitFragmentAndQuery(s: string): {
  pathPart: string;
  suffix: string;
} {
  const hashIdx = s.indexOf("#");
  const queryIdx = s.indexOf("?");
  // Whichever marker comes first wins.
  let cut = -1;
  if (hashIdx !== -1) cut = hashIdx;
  if (queryIdx !== -1 && (cut === -1 || queryIdx < cut)) cut = queryIdx;
  if (cut === -1) return { pathPart: s, suffix: "" };
  return { pathPart: s.slice(0, cut), suffix: s.slice(cut) };
}
