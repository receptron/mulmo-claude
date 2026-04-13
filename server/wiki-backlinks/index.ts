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
import { log } from "../logger/index.js";
import { updateSessionBacklinks } from "./sessionBacklinks.js";

// Small tolerance for filesystem mtime granularity (some filesystems
// only record to 1-second precision). Without this, a page written
// within the same millisecond as turnStartedAt could be skipped.
const MTIME_TOLERANCE_MS = 1000;

export interface WikiBacklinksDeps {
  readdir: (dir: string) => Promise<string[]>;
  stat: (p: string) => Promise<{ mtimeMs: number }>;
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<void>;
}

const defaultDeps: WikiBacklinksDeps = {
  readdir: (dir) => fsp.readdir(dir),
  stat: (p) => fsp.stat(p),
  readFile: (p) => fsp.readFile(p, "utf-8"),
  writeFile: (p, content) => fsp.writeFile(p, content, "utf-8"),
};

export interface MaybeAppendWikiBacklinksOptions {
  chatSessionId: string;
  turnStartedAt: number;
  workspaceRoot?: string;
  deps?: Partial<WikiBacklinksDeps>;
}

export async function maybeAppendWikiBacklinks(
  opts: MaybeAppendWikiBacklinksOptions,
): Promise<void> {
  if (!opts.chatSessionId) return;
  const workspaceRoot = opts.workspaceRoot ?? defaultWorkspacePath;
  const deps: WikiBacklinksDeps = { ...defaultDeps, ...(opts.deps ?? {}) };
  const pagesDir = path.join(workspaceRoot, "wiki", "pages");

  const files = await listPageFiles(pagesDir, deps);
  if (files.length === 0) return;

  const threshold = opts.turnStartedAt - MTIME_TOLERANCE_MS;
  for (const fileName of files) {
    await processOneFile(
      pagesDir,
      fileName,
      opts.chatSessionId,
      threshold,
      deps,
    );
  }
}

async function listPageFiles(
  pagesDir: string,
  deps: WikiBacklinksDeps,
): Promise<string[]> {
  try {
    const entries = await deps.readdir(pagesDir);
    return entries.filter((name) => name.endsWith(".md"));
  } catch {
    // `wiki/pages/` may not exist yet — first run, empty workspace.
    // Not an error.
    return [];
  }
}

async function processOneFile(
  pagesDir: string,
  fileName: string,
  sessionId: string,
  mtimeThreshold: number,
  deps: WikiBacklinksDeps,
): Promise<void> {
  const fullPath = path.join(pagesDir, fileName);
  try {
    const st = await deps.stat(fullPath);
    if (st.mtimeMs < mtimeThreshold) return;

    const content = await deps.readFile(fullPath);
    const linkHref = `../../chat/${sessionId}.jsonl`;
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
