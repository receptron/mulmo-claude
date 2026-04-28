// Driver for wiki page session-backlink appendix (#109).
//
// The agent route calls `maybeAppendWikiBacklinks({ chatSessionId,
// turnStartedAt, ... })` from its `finally` block — fire-and-forget.
// This module:
//
//   - scans `wiki/pages/*.md` for files modified during this turn
//   - appends a session backlink to each qualifying page
//   - swallows all errors with a log.warn so nothing ever bubbles
//     back into the request handler
//
// Mtime-based detection sounds fragile but works well here because
// MulmoClaude is single-user / single-process and the turn scope is
// strictly <= one agent run. If two sessions ever overlap on the
// same page the later turn will simply add a second bullet — which
// is the intended behaviour.

import fsp from "node:fs/promises";
import path from "node:path";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { WORKSPACE_DIRS } from "../paths.js";
import { log } from "../../system/logger/index.js";
import { updateSessionBacklinks } from "./sessionBacklinks.js";
import { writeWikiPage } from "../wiki-pages/io.js";
import { ONE_SECOND_MS } from "../../utils/time.js";

// Small tolerance for filesystem mtime granularity (some filesystems
// only record to 1-second precision). Without this, a page written
// within the same millisecond as turnStartedAt could be skipped.
const MTIME_TOLERANCE_MS = ONE_SECOND_MS;

export interface WikiBacklinksDeps {
  readdir: (dir: string) => Promise<string[]>;
  stat: (filePath: string) => Promise<{ mtimeMs: number }>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
}

// Default writers funnel through `writeWikiPage` so the backlink
// append participates in the same atomic-write + history pipeline
// as user / LLM edits. Pre-#763 this was a non-atomic
// `fsp.writeFile` and the call could leave a half-written page on
// crash. Editor identity is `"system"` so PR 2's snapshot view can
// distinguish automated edits from human / LLM ones.
function buildDefaultDeps(workspaceRoot: string, sessionId: string): WikiBacklinksDeps {
  return {
    readdir: (dir) => fsp.readdir(dir),
    stat: (filePath) => fsp.stat(filePath),
    readFile: (filePath) => fsp.readFile(filePath, "utf-8"),
    writeFile: async (filePath, content) => {
      const slug = path.basename(filePath, ".md");
      await writeWikiPage(slug, content, { editor: "system", sessionId }, { workspaceRoot });
    },
  };
}

export interface MaybeAppendWikiBacklinksOptions {
  chatSessionId: string;
  turnStartedAt: number;
  workspaceRoot?: string;
  deps?: Partial<WikiBacklinksDeps>;
}

export async function maybeAppendWikiBacklinks(opts: MaybeAppendWikiBacklinksOptions): Promise<void> {
  if (!opts.chatSessionId) return;
  const workspaceRoot = opts.workspaceRoot ?? defaultWorkspacePath;
  const deps: WikiBacklinksDeps = { ...buildDefaultDeps(workspaceRoot, opts.chatSessionId), ...(opts.deps ?? {}) };
  const pagesDir = path.join(workspaceRoot, WORKSPACE_DIRS.wikiPages);

  const files = await listPageFiles(pagesDir, deps);
  if (files.length === 0) return;

  const threshold = opts.turnStartedAt - MTIME_TOLERANCE_MS;
  for (const fileName of files) {
    await processOneFile(pagesDir, fileName, opts.chatSessionId, threshold, deps);
  }
}

async function listPageFiles(pagesDir: string, deps: WikiBacklinksDeps): Promise<string[]> {
  try {
    const entries = await deps.readdir(pagesDir);
    return entries.filter((name) => name.endsWith(".md"));
  } catch {
    // `wiki/pages/` may not exist yet — first run, empty workspace.
    // Not an error.
    return [];
  }
}

async function processOneFile(pagesDir: string, fileName: string, sessionId: string, mtimeThreshold: number, deps: WikiBacklinksDeps): Promise<void> {
  const fullPath = path.join(pagesDir, fileName);
  try {
    const stats = await deps.stat(fullPath);
    if (stats.mtimeMs < mtimeThreshold) return;

    const content = await deps.readFile(fullPath);
    // Compute the relative path from the wiki page's directory to
    // the chat jsonl. Layout grouped both under `data/wiki/pages/`
    // and `conversations/chat/` post-#284, so the href is no longer
    // a fixed `../../chat/…` — derive from the constants.
    const workspaceRoot = path.resolve(pagesDir, "..", "..", "..");
    const chatFileAbs = path.join(workspaceRoot, WORKSPACE_DIRS.chat, `${sessionId}.jsonl`);
    // Markdown link targets are URL-ish and must use forward slashes
    // even on Windows, where `path.relative` returns backslashes.
    const linkHref = path.relative(path.dirname(fullPath), chatFileAbs).split(path.sep).join("/");
    const updated = updateSessionBacklinks(content, sessionId, linkHref);
    if (updated === content) return;

    await deps.writeFile(fullPath, updated);
    log.debug("wiki-backlinks", "appended", {
      file: `wiki/pages/${fileName}`,
    });
  } catch (err) {
    log.warn("wiki-backlinks", "failed to update page", {
      file: `wiki/pages/${fileName}`,
      error: String(err),
    });
  }
}
