// POSIX-style helpers shared by the workspace link resolvers in this
// directory (relativeLink.ts, workspaceLinkRouter.ts). Both resolve the
// same kind of string, and `normalizeWorkspacePath` carries the root-escape
// rejection — a security decision that must not be able to drift between
// two copies.

// Drop any trailing #fragment or ?query from a path-like string.
// Whichever marker comes first wins.
//
// Not the inverse of `extractQuery` in workspaceLinkRouter.ts, on purpose:
// there a "?" sitting after a "#" belongs to the fragment and yields no
// query, whereas here the "#" has already ended the path so the later "?"
// is irrelevant. The two agree on where the PATH ends and differ only on
// what follows it — do not merge them.
export function stripFragmentAndQuery(str: string): string {
  const hashIdx = str.indexOf("#");
  const queryIdx = str.indexOf("?");
  let end = str.length;
  if (hashIdx !== -1 && hashIdx < end) end = hashIdx;
  if (queryIdx !== -1 && queryIdx < end) end = queryIdx;
  return str.slice(0, end);
}

// Collapse "./" and "../" in a workspace-relative path. A ".." that would
// pop above the workspace root returns null — this is the confinement
// guard, not cosmetic tidying. An empty result is also null so the caller
// can bail out. Callers are expected to strip #fragment / ?query first.
export function normalizeWorkspacePath(path: string): string | null {
  if (path.length === 0) return null;
  const stack: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null; // escape attempt
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.length === 0 ? null : stack.join("/");
}
