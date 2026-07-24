// Shared preamble + tail for the routes that write a workspace file
// (POST /api/files/create, PUT /api/files/content). Each handler owns
// only the middle — how the target path is resolved and how the bytes
// land on disk; the body gate before it and the response after it are
// identical apart from the log label.
//
// The tail matters more than its size: it carries `publishFileChange`,
// which cache-busts subscribed View tabs and triggers the memory
// topic-index regeneration (#1032). A write route that skips it still
// returns 200, so the failure surfaces only as "I saved it but the
// screen never updated". Routing every write reply through
// `respondWithWrittenFile` makes that omission impossible to write.

import type { Response } from "express";
import { statSafeAsync } from "../../utils/files/index.js";
import { badRequest } from "../../utils/httpError.js";
import { validatePutContentRequest } from "../../utils/files/content-write-validate.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { log } from "../../system/logger/index.js";
import { publishFileChange } from "../../events/file-change.js";

/** Body of a successful write reply. API contract with the Files UI. */
export interface WriteContentResponse {
  path: string;
  size: number;
  modifiedMs: number;
}

type WriteRouteResponse = Response<WriteContentResponse | { error: string }>;

export interface WriteRequestInputs {
  relPath: string;
  content: string;
  bytes: number;
}

/** Body-shape gate shared by create + overwrite. Returns the narrowed
 *  inputs, or writes 400 and returns `null` so the caller bails.
 *
 *  The rejection log message comes from the validator, not from
 *  `logLabel`: both routes have always logged its `"PUT content: …"`
 *  strings, and deriving them from the label would silently rewrite the
 *  create route's log text. `logLabel` only names the start/ok lines. */
export function validateWriteRequestOr400(body: unknown, res: WriteRouteResponse, logLabel: string): WriteRequestInputs | null {
  const validation = validatePutContentRequest(body);
  if (!validation.ok) {
    log.warn("files", validation.logMsg, validation.logExtra);
    badRequest(res, validation.message);
    return null;
  }
  const { relPath, content, bytes } = validation;
  log.info("files", `${logLabel}: start`, { pathPreview: previewSnippet(relPath), bytes });
  return { relPath, content, bytes };
}

/** Seams for `respondWithWrittenFile`, so the reply it builds can be
 *  exercised without a filesystem or a live pub-sub bus. */
export interface WrittenFileDeps {
  stat: (absPath: string) => Promise<{ size: number; mtimeMs: number } | null>;
  publish: (relPath: string) => void;
  now: () => number;
}

const defaultWrittenFileDeps: WrittenFileDeps = {
  stat: statSafeAsync,
  // Fire-and-forget: the publisher logs its own failures and the
  // user-facing write has already succeeded.
  publish: (relPath) => void publishFileChange(relPath),
  now: () => Date.now(),
};

export interface WrittenFile {
  absPath: string;
  relPath: string;
  /** Size to report when the post-write stat fails — the byte count we
   *  intended to write. */
  fallbackBytes: number;
  logLabel: string;
}

/** Log the success line, notify subscribers, and answer with the
 *  written file's metadata. The stat is re-read rather than trusted
 *  from the request because a wiki write stamps frontmatter, so the
 *  on-disk size differs from the submitted content's. */
export async function respondWithWrittenFile(res: WriteRouteResponse, written: WrittenFile, deps: WrittenFileDeps = defaultWrittenFileDeps): Promise<void> {
  const fresh = await deps.stat(written.absPath);
  const size = fresh?.size ?? written.fallbackBytes;
  log.info("files", `${written.logLabel}: ok`, { pathPreview: previewSnippet(written.relPath), bytes: size });
  deps.publish(written.relPath);
  res.json({ path: written.relPath, size, modifiedMs: fresh?.mtimeMs ?? deps.now() });
}
