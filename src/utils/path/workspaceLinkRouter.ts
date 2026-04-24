// Classify a workspace-relative link from agent Markdown into a
// navigation target. Used by TextResponse's click handler to route
// internal links to the appropriate view (Wiki, Files, Session)
// instead of letting them fall through to the SPA router.
//
// Pure function — no DOM or Vue dependencies, fully unit-testable.

import { isExternalHref, extractSessionIdFromPath } from "./relativeLink";

export type WorkspaceLinkTarget = { kind: "wiki"; slug: string } | { kind: "file"; path: string } | { kind: "session"; sessionId: string };

// Match `data/wiki/pages/<slug>.md` or `wiki/pages/<slug>.md`.
const WIKI_PAGE_PATTERN = /(?:data\/)?wiki\/pages\/([^/]+)\.md$/;

// Match `conversations/chat/<id>.jsonl` (delegates to extractSessionIdFromPath).
const CHAT_LOG_PREFIX = "conversations/";

/**
 * Given a raw href attribute from agent Markdown, return a typed
 * navigation target, or null if the link is external, anchor-only,
 * or unresolvable.
 *
 * Agent links are typically workspace-root-relative (e.g.
 * `data/wiki/pages/foo.md`). Relative paths with `../` that escape
 * the workspace root return null.
 */
export function classifyWorkspacePath(href: string): WorkspaceLinkTarget | null {
  if (!href || isExternalHref(href)) return null;
  if (href.startsWith("#")) return null;

  // Strip fragment and query
  const cleaned = stripFragmentAndQuery(href);
  if (cleaned.length === 0) return null;

  // Normalize path (collapse ./ and ../, reject root-escape)
  const normalized = normalizePath(cleaned);
  if (!normalized) return null;

  // Wiki page: data/wiki/pages/<slug>.md
  const wikiMatch = normalized.match(WIKI_PAGE_PATTERN);
  if (wikiMatch) {
    return { kind: "wiki", slug: wikiMatch[1] };
  }

  // Chat session log: conversations/chat/<id>.jsonl
  if (normalized.startsWith(CHAT_LOG_PREFIX)) {
    const chatPath = normalized.slice(CHAT_LOG_PREFIX.length);
    const sessionId = extractSessionIdFromPath(chatPath);
    if (sessionId) {
      return { kind: "session", sessionId };
    }
  }

  // Everything else: open in Files view
  return { kind: "file", path: normalized };
}

/**
 * Resolve a potentially-relative href against a workspace base directory.
 * Relative paths (`./`, `../`) are prepended with `baseDir` so that
 * `classifyWorkspacePath` can normalize the `../` segments.
 * Bare filenames (no `/`) are also treated as relative to `baseDir`.
 *
 * Example: resolveWikiHref("../sources/foo.md", "data/wiki/pages")
 *        → "data/wiki/pages/../sources/foo.md"
 *        → (after normalization by classifyWorkspacePath) "data/wiki/sources/foo.md"
 */
export function resolveWikiHref(href: string, baseDir: string): string {
  if (isExternalHref(href)) return href;
  if (href.startsWith("./") || href.startsWith("../") || !href.includes("/")) {
    return `${baseDir}/${href}`;
  }
  return href;
}

function stripFragmentAndQuery(str: string): string {
  const hashIdx = str.indexOf("#");
  const queryIdx = str.indexOf("?");
  let end = str.length;
  if (hashIdx !== -1 && hashIdx < end) end = hashIdx;
  if (queryIdx !== -1 && queryIdx < end) end = queryIdx;
  return str.slice(0, end);
}

function normalizePath(raw: string): string | null {
  if (raw.length === 0) return null;
  const parts = raw.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length === 0 ? null : stack.join("/");
}
