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

export function computeSearchHash(query: string, sessionId: string, timestamp: Date): string {
  return createHash("sha256").update(`${query}\n${sessionId}\n${timestamp.toISOString()}`, "utf-8").digest("base64url").slice(0, SEARCH_HASH_LEN);
}

export interface SearchPathInputs {
  query: string;
  sessionId: string;
  timestamp: Date;
}

// Returns the workspace-relative path (POSIX slashes) where the search
// file should live, e.g. "conversations/searches/2026-04-13/foo-abc12345.md".
export function computeSearchRelPath(inputs: SearchPathInputs): string {
  const slug = slugify(inputs.query, "search", MAX_QUERY_SLUG_CHARS);
  const hash = computeSearchHash(inputs.query, inputs.sessionId, inputs.timestamp);
  const dateDir = toUtcIsoDate(inputs.timestamp);
  return path.posix.join(SEARCHES_DIR, dateDir, `${slug}-${hash}.md`);
}

export interface SearchContentInputs {
  query: string;
  sessionId: string;
  timestamp: Date;
  resultBody: string;
}

// Build the on-disk markdown body: YAML frontmatter with
// machine-readable metadata, then a human-readable heading, then the
// raw search result body verbatim.
export function buildSearchMarkdown(inputs: SearchContentInputs): string {
  const { query, sessionId, timestamp, resultBody } = inputs;
  const body = resultBody.endsWith("\n") ? resultBody : `${resultBody}\n`;
  return [
    "---",
    `query: ${jsonStringSafe(query)}`,
    `sessionId: ${sessionId}`,
    `ts: ${timestamp.toISOString()}`,
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
function jsonStringSafe(input: string): string {
  const needsQuote = /[:#\n]/.test(input) || input !== input.trim();
  return needsQuote ? JSON.stringify(input) : input;
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
  writeFile: (filePath, content) => fsp.writeFile(filePath, content, "utf-8"),
};

/**
 * Save the search result to disk and return the workspace-relative
 * path that should be used as the jsonl `contentRef`.
 */
export async function writeSearchResult(inputs: WriteSearchInputs, deps: Partial<WriteSearchDeps> = {}): Promise<string> {
  const relPath = computeSearchRelPath({
    query: inputs.query,
    sessionId: inputs.sessionId,
    timestamp: inputs.timestamp,
  });
  const absPath = path.join(inputs.workspaceRoot, relPath);
  const activeDeps: WriteSearchDeps = { ...defaultDeps, ...deps };
  await activeDeps.mkdir(path.dirname(absPath));
  await activeDeps.writeFile(absPath, buildSearchMarkdown(inputs));
  return relPath;
}
