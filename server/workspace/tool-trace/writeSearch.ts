// Saves WebSearch results as a durable markdown file under
// `workspace/conversations/searches/YYYY-MM-DD/<slug>-<hash>.md` and
// returns the workspace-relative path for use as a jsonl `contentRef`.
//
// The pure helpers (slug / hash / path / content template) are
// exported for unit tests; the side-effecting function at the end is
// a thin wrapper.

import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { slugify } from "../../utils/slug.js";
import { toUtcIsoDate } from "../../utils/date.js";
import { WORKSPACE_DIRS } from "../paths.js";

export const SEARCHES_DIR = WORKSPACE_DIRS.searches;
const SEARCH_HASH_LEN = 8;
const MAX_QUERY_SLUG_CHARS = 40;

// Re-export for backwards compatibility with callers that imported
// from this module. The function is now in utils/date.ts.
export { toUtcIsoDate as formatSearchDateDir } from "../../utils/date.js";

export function computeSearchHash(
  query: string,
  sessionId: string,
  ts: Date,
): string {
  return createHash("sha256")
    .update(`${query}\n${sessionId}\n${ts.toISOString()}`, "utf-8")
    .digest("base64url")
    .slice(0, SEARCH_HASH_LEN);
}

export interface SearchPathInputs {
  query: string;
  sessionId: string;
  ts: Date;
}

// Returns the workspace-relative path (POSIX slashes) where the search
// file should live, e.g. "conversations/searches/2026-04-13/foo-abc12345.md".
export function computeSearchRelPath(inputs: SearchPathInputs): string {
  const slug = slugify(inputs.query, "search", MAX_QUERY_SLUG_CHARS);
  const hash = computeSearchHash(inputs.query, inputs.sessionId, inputs.ts);
  const dateDir = toUtcIsoDate(inputs.ts);
  return path.posix.join(SEARCHES_DIR, dateDir, `${slug}-${hash}.md`);
}

export interface SearchContentInputs {
  query: string;
  sessionId: string;
  ts: Date;
  resultBody: string;
}

// Build the on-disk markdown body: YAML frontmatter with
// machine-readable metadata, then a human-readable heading, then the
// raw search result body verbatim.
export function buildSearchMarkdown(inputs: SearchContentInputs): string {
  const { query, sessionId, ts, resultBody } = inputs;
  const body = resultBody.endsWith("\n") ? resultBody : `${resultBody}\n`;
  return [
    "---",
    `query: ${jsonStringSafe(query)}`,
    `sessionId: ${sessionId}`,
    `ts: ${ts.toISOString()}`,
    "---",
    "",
    `# Search: ${query}`,
    "",
    body,
  ].join("\n");
}

// Quote a string for YAML only when it could otherwise be
// misinterpreted (contains a colon, hash, or leading/trailing space).
// Cheap and good enough for a machine-authored frontmatter.
function jsonStringSafe(s: string): string {
  const needsQuote = /[:#\n]/.test(s) || s !== s.trim();
  return needsQuote ? JSON.stringify(s) : s;
}

export interface WriteSearchInputs extends SearchContentInputs {
  workspaceRoot: string;
}

export interface WriteSearchDeps {
  mkdir: (dir: string) => Promise<void>;
  writeFile: (p: string, content: string) => Promise<void>;
}

const defaultDeps: WriteSearchDeps = {
  mkdir: async (dir) => {
    await fsp.mkdir(dir, { recursive: true });
  },
  writeFile: (p, content) => fsp.writeFile(p, content, "utf-8"),
};

/**
 * Save the search result to disk and return the workspace-relative
 * path that should be used as the jsonl `contentRef`.
 */
export async function writeSearchResult(
  inputs: WriteSearchInputs,
  deps: Partial<WriteSearchDeps> = {},
): Promise<string> {
  const d: WriteSearchDeps = { ...defaultDeps, ...deps };
  const relPath = computeSearchRelPath({
    query: inputs.query,
    sessionId: inputs.sessionId,
    ts: inputs.ts,
  });
  const absPath = path.join(inputs.workspaceRoot, relPath);
  await d.mkdir(path.dirname(absPath));
  await d.writeFile(absPath, buildSearchMarkdown(inputs));
  return relPath;
}
