import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { statSafe, statSafeAsync, readDirSafeAsync, resolveWithinRoot, writeFileAtomic } from "../../utils/files/index.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, notFound, sendError, serverError } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { GitignoreFilter } from "../../utils/gitignore.js";
import { getCachedReferenceDirs } from "../../workspace/reference-dirs.js";

const router = Router();

const MAX_PREVIEW_BYTES = 1024 * 1024; // 1 MB — text content embedded in JSON
const MAX_RAW_BYTES = 50 * 1024 * 1024; // 50 MB — cap for binary streaming
const HIDDEN_DIRS = new Set([".git"]);

// Files whose basename exactly matches one of these is refused by
// every file-API endpoint. Used to keep workspace secrets
// (credentials, API keys, SSH / TLS private keys) off the HTTP
// surface. Compared against `path.basename(...).toLowerCase()`.
const SENSITIVE_BASENAMES = new Set([
  "credentials.json",
  // Claude Code credentials file written by server/credentials.ts.
  ".session-token",
  // Bearer auth token file — readable without auth via /api/files/*
  // exemption, so it must be blocked here (defense in depth).
  ".npmrc",
  ".htpasswd",
  "id_rsa",
  "id_ecdsa",
  "id_ed25519",
  "id_dsa",
]);

// File extensions whose contents are almost always secret. Compared
// against `path.extname(...).toLowerCase()`. Note: `.env` is matched
// separately below because `path.extname(".env")` returns "" —
// dotfiles with no second extension don't carry an extname.
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".crt"]);

// Decide whether `relPath` names a file whose contents should NEVER
// be served by the file API. Applied in three places:
//
// 1. `resolveSafe` returns null for sensitive paths so every
//    endpoint (content, raw, anything future) rejects them with a
//    generic 400.
// 2. `buildTreeAsync` / `listDirShallow` filter them out of
//    `/files/tree` and `/files/dir`, so the file explorer never
//    lists them in the first place.
// 3. The `.env` blocklist below is what keeps `/files/content`
//    from leaking credentials on a matching-name lookup.
//
// Exported so `test/routes/test_filesRoute.ts` can pin the matching
// rules down table-driven — regressions here silently reopen a
// credential-exfil surface.
export function isSensitivePath(relPath: string): boolean {
  const base = path.basename(relPath).toLowerCase();
  if (SENSITIVE_BASENAMES.has(base)) return true;
  // `.env` and every `.env.<something>` variant
  // (`.env.local`, `.env.production`, ...). The startsWith check
  // is scoped to `.env` to avoid false-positives on names like
  // `.environment-notes` — we only match `.env` exact or
  // `.env.<suffix>`.
  if (base === ".env") return true;
  if (base.startsWith(".env.")) return true;
  const ext = path.extname(base);
  if (SENSITIVE_EXTENSIONS.has(ext)) return true;
  return false;
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".jsonl",
  ".ndjson",
  ".yaml",
  ".yml",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".vue",
  ".html",
  ".htm",
  ".css",
  ".csv",
  ".log",
  // `.env` intentionally removed — see `isSensitivePath` below.
  // It used to be here, making `/files/content?path=.env` return
  // the workspace credentials as JSON text over an open CORS
  // endpoint. The file API now refuses sensitive paths outright;
  // this set is kept for genuine plain-text previews only.
  ".gitignore",
  ".sh",
  ".py",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".oga", ".flac", ".aac"]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".m4v", ".ogv"]);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".ogv": "video/ogg",
};

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  modifiedMs?: number;
  children?: TreeNode[];
}

interface ErrorResponse {
  error: string;
}

interface FileContentText {
  kind: "text";
  path: string;
  content: string;
  size: number;
  modifiedMs: number;
}

interface WriteContentRequest {
  path?: unknown;
  content?: unknown;
}

interface WriteContentResponse {
  path: string;
  size: number;
  modifiedMs: number;
}

interface FileContentMeta {
  kind: "image" | "pdf" | "audio" | "video" | "binary" | "too-large";
  path: string;
  size: number;
  modifiedMs: number;
  message?: string;
}

type FileContentResponse = FileContentText | FileContentMeta;

export type ContentKind = "text" | "image" | "pdf" | "audio" | "video" | "binary";

// Exported for unit tests. Classification is purely extension-based
// and case-insensitive (via `path.extname(...).toLowerCase()`).
export function classify(filename: string): ContentKind {
  const ext = path.extname(filename).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (ext === ".pdf") return "pdf";
  // Files with no extension (e.g. README, LICENSE) — treat as text
  if (!ext) return "text";
  return "binary";
}

// Cached realpath of the workspace. Computed once at module load so
// every request avoids the syscall. resolveWithinRoot needs an
// already-realpath'd root.
const workspaceReal = fs.realpathSync(workspacePath);

// Wraps the shared resolveWithinRoot helper with the additional
// hidden-dir traversal check (e.g. `.git/config`). `buildTreeAsync`
// / `listDirShallow` hide these from the listing, but the URL
// endpoints are reachable directly so they need their own check.
function resolveSafe(relPath: string): string | null {
  const resolved = resolveWithinRoot(workspaceReal, relPath);
  if (!resolved) return null;
  const relativeFromWorkspace = path.relative(workspaceReal, resolved);
  if (relativeFromWorkspace) {
    for (const seg of relativeFromWorkspace.split(path.sep)) {
      if (HIDDEN_DIRS.has(seg)) return null;
    }
  }
  // Reject workspace-sensitive filenames outright. `isSensitivePath`
  // matches on the basename so it catches `.env`, `id_rsa`, and
  // friends regardless of which directory they sit in.
  if (isSensitivePath(resolved)) return null;
  return resolved;
}

// ── Reference directory path resolution ──────────────────────────

const REF_PREFIX = "@ref/";

function isRefPath(relPath: string): boolean {
  return relPath.startsWith(REF_PREFIX);
}

/**
 * Resolve a `@ref/<label>/remainder` path against a registered
 * reference directory. Returns the absolute host path or null if
 * the label is unknown, the path escapes the ref root, or the
 * resolved file is sensitive / hidden.
 */
function resolveRefPath(prefixedPath: string): string | null {
  const afterPrefix = prefixedPath.slice(REF_PREFIX.length);
  const slashIdx = afterPrefix.indexOf("/");
  const label = slashIdx >= 0 ? afterPrefix.slice(0, slashIdx) : afterPrefix;
  const remainder = slashIdx >= 0 ? afterPrefix.slice(slashIdx + 1) : "";

  const entries = getCachedReferenceDirs();
  const entry = entries.find((refEntry) => refEntry.label === label);
  if (!entry) return null;

  let rootReal: string;
  try {
    rootReal = fs.realpathSync(entry.hostPath);
  } catch {
    return null;
  }

  // For root of the reference dir (no remainder), return the dir itself
  if (!remainder) return rootReal;

  const resolved = resolveWithinRoot(rootReal, remainder);
  if (!resolved) return null;

  // Apply the same hidden-dir and sensitive-path filters
  const relFromRoot = path.relative(rootReal, resolved);
  if (relFromRoot) {
    for (const seg of relFromRoot.split(path.sep)) {
      if (HIDDEN_DIRS.has(seg)) return null;
    }
  }
  if (isSensitivePath(resolved)) return null;

  return resolved;
}

export interface ByteRange {
  start: number;
  end: number;
}

// Parse an HTTP Range header of the form `bytes=START-END` or
// `bytes=-SUFFIX`. Returns null for malformed or unsatisfiable ranges
// so the caller can respond 416. We deliberately reject multi-range
// requests (`bytes=0-99,200-299`) since browsers don't issue them for
// media playback and supporting them would complicate the response.
//
// Exported for unit tests — this is the most security-sensitive piece
// of the file-serving surface, so it's covered exhaustively in
// `test/routes/test_filesRoute.ts`.
export function parseRange(header: string, size: number): ByteRange | null {
  // RFC 7233 §2.1: "A Range request on a representation whose current
  // length is 0 cannot be satisfied". We also need this guard at the
  // top because the naive suffix-range math below produces `end = -1`
  // for zero-byte files, which then crashes `fs.createReadStream`
  // with `ERR_OUT_OF_RANGE`.
  if (size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === "" && endStr === "") return null;
  if (startStr === "") {
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startStr);
  const end = endStr === "" ? size - 1 : Number(endStr);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || end >= size) return null;
  return { start, end };
}

// Security headers applied to every `/files/raw` response. Exported
// so a regression test can pin the exact strings down — a silent
// regression here reopens a real XSS surface (see plans/
// fix-files-raw-csp-sandbox.md for the full threat model).
//
// `sandbox` (no allow-flags) creates an opaque origin for the
// response. Even if an SVG / HTML / PDF with embedded JavaScript
// gets loaded as a top-level document or inside an iframe, its
// scripts can't access the localhost:3001 origin's cookies,
// session storage, or hit the `/api/*` endpoints. Frames rendering
// the response become sandboxed too — PDFs still work because
// they don't rely on same-origin access to the parent.
//
// `nosniff` stops Chrome / Firefox from re-guessing Content-Type
// on files the server declared but the browser might want to
// re-interpret as HTML.
export const RAW_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "sandbox",
  "X-Content-Type-Options": "nosniff",
};

function applyRawSecurityHeaders(res: Response): void {
  for (const [name, value] of Object.entries(RAW_SECURITY_HEADERS)) {
    res.setHeader(name, value);
  }
}

// If the read stream errors mid-flight (file deleted, disk error,
// permissions changed), surface a clean failure to the client instead
// of leaving the connection hanging.
function pipeWithErrorHandling(stream: fs.ReadStream, res: Response<ErrorResponse>): void {
  stream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    serverError(res, `Failed to read file: ${err.message}`);
  });
  stream.pipe(res);
}

// Async workspace tree walker — recurses through the workspace with
// the same security filters as the original sync implementation
// (hidden dirs, sensitive files, symlinks all rejected) and the same
// ordering (dirs before files, alphabetical within type). Uses
// `fs.promises` throughout so the walk never blocks the event loop,
// and fans out each directory's children in parallel via
// `Promise.all`.
//
// Exported so unit tests can point it at a tmp dir fixture.
export async function buildTreeAsync(absPath: string, relPath: string, gitFilter?: GitignoreFilter): Promise<TreeNode> {
  const stat = await statSafeAsync(absPath);
  if (!stat) {
    // Caller is expected to have resolved `absPath` beforehand; if it
    // vanished between resolve and walk, surface an empty dir node.
    return {
      name: path.basename(absPath),
      path: relPath,
      type: "dir",
      children: [],
    };
  }
  if (!stat.isDirectory()) {
    return {
      name: path.basename(absPath),
      path: relPath,
      type: "file",
      size: stat.size,
      modifiedMs: stat.mtimeMs,
    };
  }
  const entries = await readDirSafeAsync(absPath);
  // Pick up any .gitignore in this directory so its rules apply to
  // children. The filter chains: parent rules + local .gitignore.
  // When gitFilter is undefined (workspace root), DON'T read the
  // root .gitignore (it's for git, not the UI). Pass a fresh empty
  // filter so children pick up THEIR .gitignore files.
  const localFilter = gitFilter ? gitFilter.childForDir(absPath) : new GitignoreFilter();
  // Build every surviving child concurrently. Filter:
  // skip hidden dirs, sensitive files, symlinks, .gitignore matches,
  // and entries that fail to stat.
  const childPromises: Promise<TreeNode | null>[] = entries.map(async (entry): Promise<TreeNode | null> => {
    if (HIDDEN_DIRS.has(entry.name)) return null;
    if (!entry.isDirectory() && isSensitivePath(entry.name)) return null;
    if (entry.isSymbolicLink()) return null;
    const childRel = relPath ? path.join(relPath, entry.name) : entry.name;
    // .gitignore check: for directories, append trailing / so
    // directory-only patterns (e.g. "node_modules/") match.
    if (localFilter) {
      const testPath = entry.isDirectory() ? `${childRel}/` : childRel;
      if (localFilter.ignores(testPath)) return null;
    }
    const childAbs = path.join(absPath, entry.name);
    const childStat = await statSafeAsync(childAbs);
    if (!childStat) return null;
    return buildTreeAsync(childAbs, childRel, localFilter);
  });
  const resolved = await Promise.all(childPromises);
  const children = resolved.filter((childNode): childNode is TreeNode => childNode !== null);
  children.sort((leftChild, rightChild) => {
    if (leftChild.type !== rightChild.type) return leftChild.type === "dir" ? -1 : 1;
    return leftChild.name.localeCompare(rightChild.name);
  });
  return {
    name: relPath ? path.basename(relPath) : "",
    path: relPath,
    type: "dir",
    modifiedMs: stat.mtimeMs,
    children,
  };
}

// Shallow variant: return the given directory's immediate children
// only (no recursion). Used by the lazy-expand endpoint below — the
// client fetches one level at a time as the user expands nodes,
// so the initial Files view load cost is O(root entries) rather than
// O(all workspace files).
//
// Exported for unit tests.
export async function listDirShallow(absPath: string, relPath: string, gitFilter?: GitignoreFilter): Promise<TreeNode> {
  const stat = await statSafeAsync(absPath);
  if (!stat || !stat.isDirectory()) {
    return {
      name: relPath ? path.basename(relPath) : "",
      path: relPath,
      type: "dir",
      children: [],
    };
  }
  const entries = await readDirSafeAsync(absPath);
  // When gitFilter is undefined (workspace root), DON'T read the
  // root .gitignore (it's for git, not the UI). Pass a fresh empty
  // filter so children pick up THEIR .gitignore files.
  const localFilter = gitFilter ? gitFilter.childForDir(absPath) : new GitignoreFilter();
  const childPromises: Promise<TreeNode | null>[] = entries.map(async (entry): Promise<TreeNode | null> => {
    if (HIDDEN_DIRS.has(entry.name)) return null;
    if (!entry.isDirectory() && isSensitivePath(entry.name)) return null;
    if (entry.isSymbolicLink()) return null;
    const childRel = relPath ? path.join(relPath, entry.name) : entry.name;
    if (localFilter) {
      const testPath = entry.isDirectory() ? `${childRel}/` : childRel;
      if (localFilter.ignores(testPath)) return null;
    }
    const childAbs = path.join(absPath, entry.name);
    const childStat = await statSafeAsync(childAbs);
    if (!childStat) return null;
    if (childStat.isDirectory()) {
      return {
        name: entry.name,
        path: childRel,
        type: "dir",
        modifiedMs: childStat.mtimeMs,
        // No `children` field — caller fetches via another
        // /api/files/dir call on expand.
      };
    }
    return {
      name: entry.name,
      path: childRel,
      type: "file",
      size: childStat.size,
      modifiedMs: childStat.mtimeMs,
    };
  });
  const resolved = await Promise.all(childPromises);
  const children = resolved.filter((childNode): childNode is TreeNode => childNode !== null);
  children.sort((leftChild, rightChild) => {
    if (leftChild.type !== rightChild.type) return leftChild.type === "dir" ? -1 : 1;
    return leftChild.name.localeCompare(rightChild.name);
  });
  return {
    name: relPath ? path.basename(relPath) : "",
    path: relPath,
    type: "dir",
    modifiedMs: stat.mtimeMs,
    children,
  };
}

router.get(API_ROUTES.files.tree, async (_req: Request<object, unknown, unknown, object>, res: Response<TreeNode | ErrorResponse>) => {
  try {
    // Start with an empty filter — the workspace root's .gitignore
    // is for git (excluding github/ from commits), NOT for the
    // Files UI. Only .gitignore files inside subdirectories (e.g.
    // github/mulmoclaude/.gitignore) are applied.
    // Pass undefined = skip workspace root .gitignore (it's for
    // git, not the UI). Sub-dir .gitignore files still apply.
    const tree = await buildTreeAsync(workspaceReal, "");
    res.json(tree);
  } catch (err) {
    res.status(500).json({ error: `Failed to read workspace: ${errorMessage(err)}` });
  }
});

// Lazy-expand endpoint. Returns one directory's immediate children
// (no recursion) so the client can render the tree incrementally.
// `path` is optional; empty / missing = workspace root.
router.get(API_ROUTES.files.dir, async (req: Request<object, unknown, unknown, PathQuery>, res: Response<TreeNode | ErrorResponse>) => {
  const relPath = typeof req.query.path === "string" ? req.query.path : "";

  // Reference directory branch — resolve against the registered ref dir
  if (isRefPath(relPath)) {
    const absPath = resolveRefPath(relPath);
    if (!absPath) {
      notFound(res, "Not found");
      return;
    }
    const stat = await statSafeAsync(absPath);
    if (!stat || !stat.isDirectory()) {
      notFound(res, "Not found");
      return;
    }
    const node = await listDirShallow(absPath, relPath, undefined);
    res.json(node);
    return;
  }

  // Workspace path — existing logic
  const absPath = resolveSafe(relPath);
  if (!absPath) {
    notFound(res, "Not found");
    return;
  }
  const stat = await statSafeAsync(absPath);
  if (!stat) {
    notFound(res, "Not found");
    return;
  }
  if (!stat.isDirectory()) {
    badRequest(res, "path is not a directory");
    return;
  }
  try {
    // Build the gitignore filter chain. Start undefined at root
    // (workspace root .gitignore is for git, not the UI). Once we
    // descend into a sub-dir, childForDir picks up local .gitignore.
    let filter: GitignoreFilter | undefined;
    const segments = path.relative(workspaceReal, absPath).split(path.sep).filter(Boolean);
    let walkAbs = workspaceReal;
    for (const seg of segments) {
      walkAbs = path.join(walkAbs, seg);
      filter = filter ? filter.childForDir(walkAbs) : new GitignoreFilter().childForDir(walkAbs);
    }
    const listing = await listDirShallow(absPath, path.relative(workspaceReal, absPath), filter);
    res.json(listing);
  } catch (err) {
    serverError(res, `Failed to read directory: ${errorMessage(err)}`);
  }
});

interface PathQuery {
  path?: string;
}

// Shared validation preamble for /files/content and /files/raw. Both
// endpoints need to: read `path` from the query, validate it's
// inside the workspace (with symlink hardening), stat it, and
// confirm it's a regular file. On any failure this writes the
// appropriate 4xx response and returns null; the caller bails out.
//
// `T` lets each caller's Response type stay precise — both endpoints
// have different success-shape unions and we just need ErrorResponse
// to be one of the alternatives.
//
// Order matters: stat the syntactic candidate first so a missing
// file gets a 404, then run the realpath-hardened resolveSafe check
// for symlink escapes (which would return 400). Doing them in this
// order keeps 404 reachable for the common "file not found" case
// instead of conflating it with traversal attempts.
function resolveAndStatFile<T>(
  req: Request<object, unknown, unknown, PathQuery>,
  res: Response<T | ErrorResponse>,
): { relPath: string; absPath: string; stat: fs.Stats } | null {
  const relPath = typeof req.query.path === "string" ? req.query.path : "";
  if (!relPath) {
    badRequest(res, "path required");
    return null;
  }

  // Reference directory branch
  if (isRefPath(relPath)) {
    const absPath = resolveRefPath(relPath);
    if (!absPath) {
      notFound(res, "Not found");
      return null;
    }
    const stat = statSafe(absPath);
    if (!stat || !stat.isFile()) {
      notFound(res, "File not found");
      return null;
    }
    return { relPath, absPath, stat };
  }

  // Workspace path — existing logic
  // Syntactic candidate (no symlink resolution yet).
  const candidate = path.resolve(workspaceReal, path.normalize(relPath));
  const stat = statSafe(candidate);
  if (!stat) {
    // Distinguish "missing file under workspace" (404) from "path
    // syntactically outside workspace" (400). We check the
    // syntactic relative form, NOT realpath, because the file
    // doesn't exist so realpath would throw anyway.
    const relativeFromWorkspace = path.relative(workspaceReal, candidate);
    const escapesSyntactically = relativeFromWorkspace === ".." || relativeFromWorkspace.startsWith(`..${path.sep}`);
    if (escapesSyntactically) {
      badRequest(res, "Path outside workspace");
    } else {
      notFound(res, "File not found");
    }
    return null;
  }
  if (!stat.isFile()) {
    badRequest(res, "Not a file");
    return null;
  }
  // File exists — run the realpath-hardened check to defeat
  // symlink-escape attempts (e.g. workspace/secret → /etc/passwd).
  // resolveSafe also rejects paths that traverse a hidden dir.
  const absPath = resolveSafe(relPath);
  if (!absPath) {
    badRequest(res, "Path outside workspace");
    return null;
  }
  return { relPath, absPath, stat };
}

router.get(API_ROUTES.files.content, (req: Request<object, unknown, unknown, PathQuery>, res: Response<FileContentResponse | ErrorResponse>) => {
  const ctx = resolveAndStatFile(req, res);
  if (!ctx) return;
  const { relPath, absPath, stat } = ctx;

  const meta = {
    path: relPath,
    size: stat.size,
    modifiedMs: stat.mtimeMs,
  };

  // Anything past the binary stream cap is "too-large" regardless of
  // type — even images/PDFs, since the client would have to fetch
  // them via /files/raw which enforces the same limit.
  if (stat.size > MAX_RAW_BYTES) {
    res.json({
      kind: "too-large",
      ...meta,
      message: `File too large to preview (${stat.size} bytes)`,
    });
    return;
  }

  const kind = classify(absPath);
  if (kind === "image" || kind === "pdf" || kind === "audio" || kind === "video") {
    res.json({ kind, ...meta });
    return;
  }
  if (kind === "binary") {
    res.json({
      kind: "binary",
      ...meta,
      message: "Binary file — preview not supported",
    });
    return;
  }
  if (stat.size > MAX_PREVIEW_BYTES) {
    res.json({
      kind: "too-large",
      ...meta,
      message: `Text file too large to preview (${stat.size} bytes)`,
    });
    return;
  }
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf-8");
  } catch (err) {
    res.status(500).json({ error: `Failed to read file: ${errorMessage(err)}` });
    return;
  }
  res.json({ kind: "text", ...meta, content });
});

// Write the body of an existing text file. Only text-classified files
// (per `classify`) are editable — binary, image, audio, etc. are
// refused so the endpoint can't be used to ship arbitrary uploads.
// The file must already exist; creating new files is out of scope.
router.put(API_ROUTES.files.content, async (req: Request<object, unknown, WriteContentRequest>, res: Response<WriteContentResponse | ErrorResponse>) => {
  const { path: relPathRaw, content: contentRaw } = req.body ?? {};
  if (typeof relPathRaw !== "string" || relPathRaw.length === 0) {
    badRequest(res, "path required");
    return;
  }
  if (typeof contentRaw !== "string") {
    badRequest(res, "content required");
    return;
  }
  if (Buffer.byteLength(contentRaw, "utf-8") > MAX_PREVIEW_BYTES) {
    badRequest(res, `content exceeds ${MAX_PREVIEW_BYTES} byte limit`);
    return;
  }
  // Two-step resolution to distinguish "path outside workspace" (400)
  // from "file does not exist" (404): realpath throws on ENOENT, so
  // resolveSafe conflates the two. Stat the syntactic candidate
  // first; if it exists, THEN run the symlink-hardened resolveSafe.
  const candidate = path.resolve(workspaceReal, path.normalize(relPathRaw));
  const existing = await statSafeAsync(candidate);
  if (!existing) {
    const relativeFromWorkspace = path.relative(workspaceReal, candidate);
    const escapesSyntactically = relativeFromWorkspace === ".." || relativeFromWorkspace.startsWith(`..${path.sep}`);
    if (escapesSyntactically) {
      badRequest(res, "Path outside workspace");
    } else {
      notFound(res, "File not found");
    }
    return;
  }
  if (!existing.isFile()) {
    badRequest(res, "Not a file");
    return;
  }
  const absPath = resolveSafe(relPathRaw);
  if (!absPath) {
    badRequest(res, "Path outside workspace");
    return;
  }
  if (classify(absPath) !== "text") {
    badRequest(res, "File type not editable");
    return;
  }
  try {
    // `uniqueTmp: true` appends a randomUUID to the tmp filename so
    // two simultaneous PUTs to the same path can't clobber each
    // other's staging file and race through the rename.
    await writeFileAtomic(absPath, contentRaw, { uniqueTmp: true });
  } catch (err) {
    serverError(res, `Failed to write file: ${errorMessage(err)}`);
    return;
  }
  const fresh = await statSafeAsync(absPath);
  res.json({
    path: relPathRaw,
    size: fresh?.size ?? Buffer.byteLength(contentRaw, "utf-8"),
    modifiedMs: fresh?.mtimeMs ?? Date.now(),
  });
});

router.get(API_ROUTES.files.raw, (req: Request<object, unknown, unknown, PathQuery>, res: Response<ErrorResponse>) => {
  const ctx = resolveAndStatFile(req, res);
  if (!ctx) return;
  const { absPath, stat } = ctx;

  if (stat.size > MAX_RAW_BYTES) {
    sendError(res, 413, `File too large to stream (${stat.size} bytes, limit ${MAX_RAW_BYTES})`);
    return;
  }
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mime);
  // Sandbox the response so an `.svg` / `.html` / `.pdf` with
  // embedded JavaScript can't escape into the localhost:3001
  // origin via direct navigation or <iframe>. See
  // plans/done/fix-files-raw-csp-sandbox.md for the threat model.
  applyRawSecurityHeaders(res);

  // Range support is required for `<video>` playback (Safari refuses
  // to play media without 206 responses) and for seek-past-buffered
  // in `<audio>`. When no Range header is sent we fall through to
  // the existing full-file pipe.
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, stat.size);
    if (!range) {
      // The media MIME was set above so the 206 success path
      // doesn't have to repeat it, but on a 416 we want JSON so
      // `res.json` doesn't lie about the body's content-type. Set
      // the Content-Range per RFC 7233 §4.4 before sending.
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Range", `bytes */${stat.size}`);
      sendError(res, 416, "Range not satisfiable");
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    pipeWithErrorHandling(fs.createReadStream(absPath, { start: range.start, end: range.end }), res);
    return;
  }

  res.setHeader("Content-Length", String(stat.size));
  pipeWithErrorHandling(fs.createReadStream(absPath), res);
});

// ── Reference directory roots ───────────────────────────────────
//
// Returns configured reference directories as top-level TreeNode[]
// for the file explorer. Each node's path uses the @ref/<label>
// prefix so subsequent /dir and /content requests route correctly.

router.get(API_ROUTES.files.refRoots, async (_req: Request, res: Response<TreeNode[]>) => {
  const entries = getCachedReferenceDirs();
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    const stat = await statSafeAsync(entry.hostPath);
    if (!stat || !stat.isDirectory()) continue;
    nodes.push({
      name: entry.label,
      path: `${REF_PREFIX}${entry.label}`,
      type: "dir",
      modifiedMs: stat.mtimeMs,
    });
  }
  res.json(nodes);
});

export default router;
