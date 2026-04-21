// Pure helpers used by FilesView to decide how to handle a click on
// an <a> inside rendered markdown. Kept free of DOM types so it can
// be exhaustively unit-tested.
//
// The two shipped functions are:
//
//   - isExternalHref(href): should this click escape to the browser?
//   - resolveWorkspaceLink(currentFile, href): resolve a markdown
//     href to a workspace-relative path the file viewer can open.

// --- External URL detection ---------------------------------------

// Return true when `href` points at something that isn't inside the
// workspace (http/https/mailto/tel/custom schemes, protocol-relative
// URLs). The file viewer uses this to decide whether to let the
// default browser behaviour take over.
export function isExternalHref(href: string): boolean {
  if (!href) return true;
  // Protocol-relative (//example.com/foo) → external.
  if (href.startsWith("//")) return true;
  // Fast-path for the common schemes.
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("ftp://")) {
    return true;
  }
  // Generic scheme detection: any "scheme:" prefix where the colon
  // comes before the first slash is an external URL. Avoid a regex
  // so we don't trip sonarjs/slow-regex.
  const colonIdx = href.indexOf(":");
  if (colonIdx > 0) {
    const slashIdx = href.indexOf("/");
    if (slashIdx === -1 || slashIdx > colonIdx) return true;
  }
  return false;
}

// --- Workspace link resolution ------------------------------------

// Given the workspace-relative path of the file currently being
// viewed (`currentFilePath`, e.g. "summaries/topics/refactoring.md")
// and the raw href of a clicked link, return the resolved workspace-
// relative path of the target file, or null if the link:
//
//   - is external (handled by the browser instead)
//   - is an anchor-only link (scroll, let the browser handle it)
//   - would escape the workspace root via "../"
//   - is empty or a pure query/fragment
//
// `#fragment` / `?query` suffixes are stripped — the file viewer
// only navigates by path.
export function resolveWorkspaceLink(currentFilePath: string, href: string): string | null {
  if (!href) return null;
  if (isExternalHref(href)) return null;
  if (href.startsWith("#")) return null;

  // Strip #fragment and ?query BEFORE joining so a pure-query href
  // like "?foo=1" isn't smuggled into the current directory and
  // resolved to the parent.
  const cleaned = stripFragmentAndQuery(href);
  if (cleaned.length === 0) return null;

  // Workspace-absolute (starts with a single "/"): strip the slash
  // and treat the rest as workspace-relative.
  let joined: string;
  if (cleaned.startsWith("/")) {
    joined = cleaned.slice(1);
  } else {
    const currentDir = posixDirname(currentFilePath);
    joined = currentDir === "" ? cleaned : `${currentDir}/${cleaned}`;
  }

  return normalizeWorkspacePath(joined);
}

// Drop any trailing #fragment or ?query from a path-like string.
// Whichever marker comes first wins.
function stripFragmentAndQuery(s: string): string {
  const hashIdx = s.indexOf("#");
  const queryIdx = s.indexOf("?");
  let end = s.length;
  if (hashIdx !== -1 && hashIdx < end) end = hashIdx;
  if (queryIdx !== -1 && queryIdx < end) end = queryIdx;
  return s.slice(0, end);
}

// If `resolvedPath` points at a chat session log (e.g.
// `chat/abc-123.jsonl`), return the session id. Used by the file
// viewer to recognise when a clicked markdown link should switch
// the active chat instead of opening the raw jsonl as a file.
//
// Nested paths under `chat/` (e.g. `chat/subdir/foo.jsonl`) return
// null — session ids cannot contain slashes, and we don't want to
// mis-identify unrelated files.
export function extractSessionIdFromPath(resolvedPath: string): string | null {
  const CHAT_PREFIX = "chat/";
  const JSONL_SUFFIX = ".jsonl";
  if (!resolvedPath.startsWith(CHAT_PREFIX)) return null;
  if (!resolvedPath.endsWith(JSONL_SUFFIX)) return null;
  const id = resolvedPath.slice(CHAT_PREFIX.length, resolvedPath.length - JSONL_SUFFIX.length);
  if (id.length === 0) return null;
  if (id.includes("/")) return null;
  return id;
}

// POSIX-style dirname. The file viewer always uses "/" separators
// so we don't need to worry about Windows paths.
function posixDirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

// Collapse "./" and "../" in a workspace path. Rejects paths that
// escape above the workspace root. Returns null for the empty-path
// case so the caller can bail out. Callers are expected to strip
// #fragment / ?query before invoking this function.
function normalizeWorkspacePath(p: string): string | null {
  if (p.length === 0) return null;
  const parts = p.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null; // escape attempt
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (stack.length === 0) return null;
  return stack.join("/");
}
