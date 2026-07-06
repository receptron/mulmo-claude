import { Router, Request, Response } from "express";
import { ReadStream, Stats, createReadStream, readFileSync, realpathSync } from "fs";
import { mkdir, realpath, writeFile } from "fs/promises";
import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { statSafe, statSafeAsync, readDirSafeAsync, resolveWithinRoot, writeFileAtomic } from "../../utils/files/index.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, notFound, sendError, serverError } from "../../utils/httpError.js";
import { getOptionalStringQuery } from "../../utils/request.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { GitignoreFilter } from "../../utils/gitignore.js";
import { getCachedReferenceDirs } from "../../workspace/reference-dirs.js";
import { classifyAsWikiPage, writeWikiPage } from "../../workspace/wiki-pages/io.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
import { officeKind, previewXlsx, previewDocx, previewPptxAsPdf } from "../../utils/officePreview.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SUBPROCESS_PROBE_TIMEOUT_MS } from "../../utils/time.js";
import { publishFileChange } from "../../events/file-change.js";

const execFileAsync = promisify(execFile);

const router = Router();

const MAX_PREVIEW_BYTES = 1024 * 1024; // 1 MB — text content embedded in JSON
const MAX_RAW_BYTES = 50 * 1024 * 1024; // 50 MB — cap for non-media streaming (images/pdf/binary load whole into the browser)
// Audio/video are streamed via HTTP Range requests (see GET /raw),
// so the browser never buffers the whole file. Podcasts commonly
// run 100–300 MB and recorded video can run multi-GB; cap at 4 GB
// just to keep an obviously-pathological file from being served.
const MAX_MEDIA_BYTES = 4 * 1024 * 1024 * 1024;
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

// Office document previews (#1985). All server-converted server-side
// so the client renders a table / text / PDF without shipping mammoth /
// SheetJS / LibreOffice to the browser.
interface FileContentOfficeXlsx {
  kind: "office-xlsx";
  path: string;
  size: number;
  modifiedMs: number;
  /** One entry per worksheet; `csv` is SheetJS `sheet_to_csv` output. */
  sheets: { name: string; csv: string }[];
}
interface FileContentOfficeDocx {
  kind: "office-docx";
  path: string;
  size: number;
  modifiedMs: number;
  /** Plain text extracted via mammoth. */
  content: string;
}
interface FileContentOfficePptx {
  kind: "office-pptx";
  path: string;
  size: number;
  modifiedMs: number;
  /** Client fetches the converted PDF from this URL. Present only when
   *  LibreOffice was available and conversion succeeded. */
  previewUrl: string;
}

type FileContentResponse = FileContentText | FileContentMeta | FileContentOfficeXlsx | FileContentOfficeDocx | FileContentOfficePptx;

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
const workspaceReal = realpathSync(workspacePath);

// Windows-only: cached **async-realpath** form of the workspace. On
// Windows, `realpathSync` (sync) and `realpath` (async) can return
// the same path in two different forms — 8.3 short-name (`RUNNER~1`)
// vs. long-name (`runneradmin`) — depending on which syscall path
// was used to open the dir entry. Comparing across forms via
// `path.relative` then produces a false "outside workspace" verdict
// (`..\..\runneradmin\...`). This cache mirrors `workspaceReal` but
// is guaranteed to share the form the async `realpath` returns, so
// `resolveNewFilePath`'s containment check has matching ends. On
// non-Windows hosts both syscalls return the same string, so the
// cache equals `workspaceReal` and the extra lookup is harmless.
let workspaceRealAsyncCache: string | null = null;
async function getWorkspaceRealAsync(): Promise<string> {
  if (workspaceRealAsyncCache !== null) return workspaceRealAsyncCache;
  try {
    workspaceRealAsyncCache = await realpath(workspaceReal);
  } catch {
    workspaceRealAsyncCache = workspaceReal;
  }
  return workspaceRealAsyncCache;
}

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
    rootReal = realpathSync(entry.hostPath);
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
  // for zero-byte files, which then crashes `createReadStream`
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

// Security headers applied to `/files/raw` responses. Exported so a
// regression test can pin the exact strings down — a silent
// regression here reopens a real XSS surface (see plans/done/
// fix-files-raw-csp-sandbox.md for the full threat model).
//
// `sandbox` (no allow-flags) creates an opaque origin for the
// response. Even if an SVG / HTML / PDF with embedded JavaScript
// gets loaded as a top-level document or inside an iframe, its
// scripts can't access the localhost:3001 origin's cookies,
// session storage, or hit the `/api/*` endpoints. Frames rendering
// the response become sandboxed too.
//
// `nosniff` stops Chrome / Firefox from re-guessing Content-Type
// on files the server declared but the browser might want to
// re-interpret as HTML.
export const RAW_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "sandbox",
  "X-Content-Type-Options": "nosniff",
};

// PDF responses skip `Content-Security-Policy: sandbox`. Issue
// #1299: WebKit refuses to render `sandbox`-opaque PDFs and forces
// a download, breaking the Files preview iframe on Safari. The
// PDF viewer (PDFium on Chromium, the WebKit PDF renderer, pdf.js
// on Firefox) runs embedded AcroJS inside its own sandbox; the
// response-level CSP was never the layer enforcing PDF script
// isolation. `nosniff` is kept so the response can't be
// re-interpreted as HTML.
export const RAW_SECURITY_HEADERS_PDF: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
};

/** Pick the header set for a given MIME. PDF is the only special
 *  case today — every other MIME (`image/*`, `text/*`,
 *  `application/octet-stream`, …) keeps the sandbox CSP. */
export function rawSecurityHeadersForMime(mime: string): Readonly<Record<string, string>> {
  return mime === "application/pdf" ? RAW_SECURITY_HEADERS_PDF : RAW_SECURITY_HEADERS;
}

function applyRawSecurityHeaders(res: Response, mime: string): void {
  for (const [name, value] of Object.entries(rawSecurityHeadersForMime(mime))) {
    res.setHeader(name, value);
  }
}

// If the read stream errors mid-flight (file deleted, disk error,
// permissions changed), surface a clean failure to the client instead
// of leaving the connection hanging.
function pipeWithErrorHandling(stream: ReadStream, res: Response<ErrorResponse>): void {
  stream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    // The raw `err.message` carries filesystem paths / system error
    // detail — keep it in the server log but ship a stable opaque
    // string to the client. Same threat model as `asyncHandler`.
    log.error("files", "raw stream error", { error: errorMessage(err) });
    serverError(res, "Failed to read file");
  });
  stream.pipe(res);
}

// Async workspace tree walker — recurses through the workspace with
// the same security filters as the original sync implementation
// (hidden dirs, sensitive files, symlinks all rejected) and the same
// ordering (dirs before files, alphabetical within type). Uses
// `promises` throughout so the walk never blocks the event loop,
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
  log.info("files", "GET tree: start");
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
    log.error("files", "GET tree: threw", { error: errorMessage(err) });
    serverError(res, "Failed to read workspace");
  }
});

// Lazy-expand endpoint. Returns one directory's immediate children
// (no recursion) so the client can render the tree incrementally.
// `path` is optional; empty / missing = workspace root.
router.get(API_ROUTES.files.dir, async (req: Request<object, unknown, unknown, PathQuery>, res: Response<TreeNode | ErrorResponse>) => {
  const relPath = getOptionalStringQuery(req, "path") ?? "";
  log.info("files", "GET dir: start", { pathPreview: previewSnippet(relPath) });

  // Reference directory branch — resolve against the registered ref dir
  if (isRefPath(relPath)) {
    const absPath = resolveRefPath(relPath);
    if (!absPath) {
      log.warn("files", "GET dir: ref dir not found", { pathPreview: previewSnippet(relPath) });
      notFound(res, "Not found");
      return;
    }
    const stat = await statSafeAsync(absPath);
    if (!stat || !stat.isDirectory()) {
      log.warn("files", "GET dir: ref path missing or not a dir", { pathPreview: previewSnippet(relPath) });
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
    log.warn("files", "GET dir: path outside workspace", { pathPreview: previewSnippet(relPath) });
    notFound(res, "Not found");
    return;
  }
  const stat = await statSafeAsync(absPath);
  if (!stat) {
    log.warn("files", "GET dir: not found", { pathPreview: previewSnippet(relPath) });
    notFound(res, "Not found");
    return;
  }
  if (!stat.isDirectory()) {
    log.warn("files", "GET dir: not a directory", { pathPreview: previewSnippet(relPath) });
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
    log.error("files", "GET dir: threw", { pathPreview: previewSnippet(relPath), error: errorMessage(err) });
    serverError(res, "Failed to read directory");
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
): { relPath: string; absPath: string; stat: Stats } | null {
  const relPath = getOptionalStringQuery(req, "path") ?? "";
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

interface FileMeta {
  path: string;
  size: number;
  modifiedMs: number;
}

/** Server-side conversion of Office Open XML formats for the Files view
 *  (#1985). Returns the specific `office-*` response shape on success,
 *  or `null` when the file isn't office or every converter failed —
 *  callers fall through to the generic "binary" response. Split out of
 *  the content route to keep that handler under the cognitive-complexity
 *  ceiling. */
async function tryOfficePreview(absPath: string, relPath: string, meta: FileMeta): Promise<FileContentResponse | null> {
  const office = officeKind(absPath);
  if (office === "office-xlsx") {
    const sheets = await previewXlsx(absPath);
    return sheets === null ? null : { kind: "office-xlsx", ...meta, sheets };
  }
  if (office === "office-docx") {
    const content = await previewDocx(absPath);
    return content === null ? null : { kind: "office-docx", ...meta, content };
  }
  if (office === "office-pptx") {
    const pdfPath = await previewPptxAsPdf(absPath);
    if (pdfPath === null) return null;
    const previewUrl = `${API_ROUTES.files.previewRaw}?path=${encodeURIComponent(relPath)}`;
    return { kind: "office-pptx", ...meta, previewUrl };
  }
  return null;
}

router.get(API_ROUTES.files.content, async (req: Request<object, unknown, unknown, PathQuery>, res: Response<FileContentResponse | ErrorResponse>) => {
  const requestedPath = getOptionalStringQuery(req, "path") ?? "";
  log.info("files", "GET content: start", { pathPreview: previewSnippet(requestedPath) });
  const ctx = resolveAndStatFile(req, res);
  if (!ctx) {
    // resolveAndStatFile already wrote the 4xx; surface the gate
    // miss so the operator can correlate the user-visible error
    // with a concrete reason in the log without re-running.
    log.warn("files", "GET content: gated by resolve/stat", { pathPreview: previewSnippet(requestedPath) });
    return;
  }
  const { relPath, absPath, stat } = ctx;

  const meta = {
    path: relPath,
    size: stat.size,
    modifiedMs: stat.mtimeMs,
  };

  const kind = classify(absPath);
  // Audio/video stream via Range requests, so they get the looser
  // MAX_MEDIA_BYTES cap. Everything else (images/PDFs/binary) is
  // loaded whole by the browser and stays at MAX_RAW_BYTES.
  const isStreamingMedia = kind === "audio" || kind === "video";
  const sizeCap = isStreamingMedia ? MAX_MEDIA_BYTES : MAX_RAW_BYTES;
  if (stat.size > sizeCap) {
    res.json({
      kind: "too-large",
      ...meta,
      message: `File too large to preview (${stat.size} bytes)`,
    });
    return;
  }

  if (kind === "image" || kind === "pdf" || kind === "audio" || kind === "video") {
    res.json({ kind, ...meta });
    return;
  }
  if (kind === "binary") {
    // Office Open XML formats (.xlsx / .docx / .pptx) get server-side
    // conversion so the Files view can render them inline (#1985). All
    // three converters return null on failure — we then fall through to
    // the generic "binary" response and the client shows the "Open in
    // OS" fallback UI.
    const officePreview = await tryOfficePreview(absPath, relPath, meta);
    if (officePreview !== null) {
      res.json(officePreview);
      return;
    }
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
    content = readFileSync(absPath, "utf-8");
  } catch (err) {
    log.error("files", "GET content: read threw", { pathPreview: previewSnippet(relPath), error: errorMessage(err) });
    serverError(res, "Failed to read file");
    return;
  }
  log.info("files", "GET content: ok", { pathPreview: previewSnippet(relPath), bytes: stat.size });
  res.json({ kind: "text", ...meta, content });
});

type PutContentValidation =
  { ok: true; relPath: string; content: string; bytes: number } | { ok: false; logMsg: string; logExtra?: Record<string, unknown>; message: string };

// Runtime-shape gate for PUT /api/files/content's body. Returns either
// the narrowed inputs + their byte length (computed once and reused
// downstream), or a structured rejection carrying the log message,
// log extras, and the response message — so the caller can fan them
// out into log.warn + badRequest without rebuilding context. `logExtra`
// is optional so the missing-path branch can omit it: passing `{}` to
// `log.warn` would emit `data: {}` (an observable change vs the
// pre-refactor no-third-arg call); passing `undefined` skips the
// `data` field entirely.
function validatePutContentRequest(body: unknown): PutContentValidation {
  const obj = (body ?? {}) as { path?: unknown; content?: unknown };
  const { path: relPathRaw, content: contentRaw } = obj;
  if (typeof relPathRaw !== "string" || relPathRaw.length === 0) {
    return { ok: false, logMsg: "PUT content: missing path", message: "path required" };
  }
  if (typeof contentRaw !== "string") {
    return {
      ok: false,
      logMsg: "PUT content: missing content",
      logExtra: { pathPreview: previewSnippet(relPathRaw) },
      message: "content required",
    };
  }
  const bytes = Buffer.byteLength(contentRaw, "utf-8");
  if (bytes > MAX_PREVIEW_BYTES) {
    return {
      ok: false,
      logMsg: "PUT content: too large",
      logExtra: { pathPreview: previewSnippet(relPathRaw), bytes },
      message: `content exceeds ${MAX_PREVIEW_BYTES} byte limit`,
    };
  }
  return { ok: true, relPath: relPathRaw, content: contentRaw, bytes };
}

type ResolvedTextFile = { ok: true; absPath: string } | { ok: false; status: 400 | 404; message: string };

// Two-step path resolution + text-only gate for PUT /api/files/content.
//
// Why two steps: `resolveSafe` calls `realpathSync`, which throws
// ENOENT for missing files. Conflating "path outside workspace"
// (caller bug, 400) with "file does not exist" (404) loses the
// signal. Stat the syntactic candidate first; only if it exists
// do we run the symlink-hardened resolveSafe.
//
// The classifier check rejects binary / image / audio / etc. so
// this endpoint can't be used as an arbitrary upload channel.
async function resolveExistingTextFile(relPathRaw: string): Promise<ResolvedTextFile> {
  const candidate = path.resolve(workspaceReal, path.normalize(relPathRaw));
  const existing = await statSafeAsync(candidate);
  if (!existing) {
    const relativeFromWorkspace = path.relative(workspaceReal, candidate);
    const escapesSyntactically = relativeFromWorkspace === ".." || relativeFromWorkspace.startsWith(`..${path.sep}`);
    return escapesSyntactically ? { ok: false, status: 400, message: "Path outside workspace" } : { ok: false, status: 404, message: "File not found" };
  }
  if (!existing.isFile()) return { ok: false, status: 400, message: "Not a file" };
  const absPath = resolveSafe(relPathRaw);
  if (!absPath) return { ok: false, status: 400, message: "Path outside workspace" };
  if (classify(absPath) !== "text") return { ok: false, status: 400, message: "File type not editable" };
  return { ok: true, absPath };
}

// Wiki pages route through `writeWikiPage` so the (old, new) pair
// reaches the edit-history pipeline (#763). Everything else takes
// the generic atomic write. `uniqueTmp: true` appends a randomUUID
// to the tmp filename so two simultaneous PUTs to the same path
// can't clobber each other's staging file and race through rename
// (writeWikiPage applies it internally).
//
// `workspaceReal` is the already-realpath'd workspace root —
// resolveSafe returns a realpath'd absPath, so the classifier MUST
// compare against the same realpath'd root. A symlinked workspace
// (e.g. `~/mulmoclaude` → some real path elsewhere) would otherwise
// silently bypass the wiki chokepoint.
async function writeFileContent(absPath: string, content: string): Promise<void> {
  const wikiClass = classifyAsWikiPage(absPath, { workspaceRoot: workspaceReal });
  if (wikiClass.wiki) {
    await writeWikiPage(wikiClass.slug, content, { editor: "user" }, { workspaceRoot: workspaceReal });
  } else {
    await writeFileAtomic(absPath, content, { uniqueTmp: true });
  }
}

// JSON config files are editable from the Files Explorer (#833 Phase
// 1), but a hand-edit that breaks JSON syntax would corrupt a file the
// app (or the agent) parses on read. Reject a malformed save before it
// hits disk so the editor can surface the parser error inline. `.jsonl`
// is intentionally excluded — each line is its own document, not one
// JSON value, so `JSON.parse` of the whole file would always fail.
function jsonSyntaxError(relPath: string, content: string): string | null {
  if (!relPath.toLowerCase().endsWith(".json")) return null;
  try {
    JSON.parse(content);
    return null;
  } catch (err) {
    return `Invalid JSON: ${errorMessage(err)}`;
  }
}

// Write the body of an existing text file. Only text-classified files
// (per `classify`) are editable — binary, image, audio, etc. are
// refused so the endpoint can't be used to ship arbitrary uploads.
// The file must already exist; creating new files is out of scope.
// Resolve a path for a file we expect to NOT exist yet (POST create).
// `resolveExistingTextFile` requires existence and bails with 404 for
// new files, which is exactly the create case.
//
// Hardening (Codex iter-2..6 on #1598):
//
//   - **Syntactic checks** (containment, HIDDEN_DIRS, sensitive
//     basenames, classifier) are equivalent to what `resolveSafe`
//     applies to existing paths.
//   - **realpath-walk** the deepest existing ancestor of the target.
//     PUT inherits this via `resolveSafe`'s `realpathSync` on the
//     existing file; for create the target is absent, so we walk up
//     to the first ancestor that exists, realpath that, and
//     reconstruct the final path under the resolved real ancestor.
//     A symlinked workspace subtree pointing outside `workspaceReal`
//     therefore can't route create writes outside the workspace.
async function resolveNewFilePath(
  relPathRaw: string,
): Promise<{ ok: true; absPath: string; workspaceRoot: string } | { ok: false; status: 400; message: string }> {
  const normalised = path.normalize(relPathRaw);
  if (path.isAbsolute(normalised)) return { ok: false, status: 400, message: "Path must be workspace-relative" };
  const candidate = path.resolve(workspaceReal, normalised);
  const relativeFromWorkspace = path.relative(workspaceReal, candidate);
  if (relativeFromWorkspace === ".." || relativeFromWorkspace.startsWith(`..${path.sep}`)) {
    return { ok: false, status: 400, message: "Path outside workspace" };
  }
  // Mirror `resolveSafe`: refuse `.git/` (or any HIDDEN_DIRS) segment.
  for (const seg of relativeFromWorkspace.split(path.sep)) {
    if (HIDDEN_DIRS.has(seg)) return { ok: false, status: 400, message: "Path not allowed" };
  }
  if (isSensitivePath(relativeFromWorkspace)) return { ok: false, status: 400, message: "Path not allowed" };
  if (classify(candidate) !== "text") return { ok: false, status: 400, message: "File type not editable" };
  // Walk up the candidate's ancestors until we find one that exists.
  // Realpath THAT ancestor — a symlinked in-workspace folder pointing
  // outside `workspaceReal` would otherwise let the create land outside.
  // Reconstruct the final path as the realpath'd ancestor + the
  // remaining missing segments, then re-verify containment.
  const trailing: string[] = [];
  let probe = candidate;
  let probeStat = await statSafeAsync(probe);
  while (!probeStat) {
    const parent = path.dirname(probe);
    if (parent === probe) return { ok: false, status: 400, message: `Path outside workspace (root reached at ${probe})` };
    trailing.unshift(path.basename(probe));
    probe = parent;
    probeStat = await statSafeAsync(probe);
  }
  let realProbe: string;
  try {
    realProbe = await realpath(probe);
  } catch {
    return { ok: false, status: 400, message: "Path not allowed" };
  }
  const finalAbs = trailing.length === 0 ? realProbe : path.join(realProbe, ...trailing);
  // Compare against the **async-realpath** form of the workspace, not
  // the sync form cached as `workspaceReal`. On Windows the two can
  // differ (8.3 short-name vs. long-name), and `path.relative` across
  // the two yields a spurious `..\..\..\<long-name>\...` that fails
  // the containment check. See `getWorkspaceRealAsync` for the why.
  const rootAsync = await getWorkspaceRealAsync();
  const relFromReal = path.relative(rootAsync, finalAbs);
  if (relFromReal === ".." || relFromReal.startsWith(`..${path.sep}`) || path.isAbsolute(relFromReal)) {
    return { ok: false, status: 400, message: "Path outside workspace" };
  }
  return { ok: true, absPath: finalAbs, workspaceRoot: rootAsync };
}

// Create a new text file. Refuses to overwrite — that's PUT's job and
// requires a separate explicit-overwrite UX. Used by the File
// Explorer's "New file" context menu (#1598) where the client already
// passes a slug for a file it believes doesn't exist; we re-check
// here to close the TOCTOU window between two tabs.
router.post(API_ROUTES.files.create, async (req: Request<object, unknown, WriteContentRequest>, res: Response<WriteContentResponse | ErrorResponse>) => {
  const validation = validatePutContentRequest(req.body);
  if (!validation.ok) {
    log.warn("files", validation.logMsg, validation.logExtra);
    badRequest(res, validation.message);
    return;
  }
  const { relPath, content, bytes: contentBytes } = validation;
  log.info("files", "POST create: start", { pathPreview: previewSnippet(relPath), bytes: contentBytes });

  const resolved = await resolveNewFilePath(relPath);
  if (!resolved.ok) {
    badRequest(res, resolved.message);
    return;
  }
  const jsonError = jsonSyntaxError(relPath, content);
  if (jsonError !== null) {
    log.warn("files", "POST create: invalid JSON", { pathPreview: previewSnippet(relPath) });
    badRequest(res, jsonError);
    return;
  }
  // Atomic create: `wx` (POSIX O_EXCL) — fails with EEXIST if the
  // target already exists, closing the check-then-write TOCTOU that
  // Codex flagged on earlier iterations. Wiki pages route through
  // `writeWikiPage` with `exclusive: true` so the same exclusive
  // primitive applies after the frontmatter stamp.
  try {
    // `resolved.workspaceRoot` is the async-realpath form, matching
    // `resolved.absPath`'s form. Passing the sync-form `workspaceReal`
    // would make `classifyAsWikiPage` fail to match the prefix on
    // Windows (8.3 short-name vs. long-name) — we'd fall into the
    // plain-file branch and skip the wiki frontmatter stamp.
    const wikiClass = classifyAsWikiPage(resolved.absPath, { workspaceRoot: resolved.workspaceRoot });
    if (wikiClass.wiki) {
      await writeWikiPage(wikiClass.slug, content, { editor: "user" }, { workspaceRoot: resolved.workspaceRoot, exclusive: true });
    } else {
      await mkdir(path.dirname(resolved.absPath), { recursive: true });
      await writeFile(resolved.absPath, content, { flag: "wx" });
    }
  } catch (err) {
    const { code } = err as { code?: string };
    if (code === "EEXIST") {
      log.warn("files", "POST create: conflict", { pathPreview: previewSnippet(relPath) });
      sendError(res, 409, "File already exists");
      return;
    }
    // EISDIR: the target path already exists as a directory. That's
    // a client-visible conflict (you can't replace a dir with a
    // file via this endpoint), not a server error. Maps to the same
    // 409 lane so the inline UI shows the localised "exists" copy.
    if (code === "EISDIR") {
      log.warn("files", "POST create: target is a directory", { pathPreview: previewSnippet(relPath) });
      sendError(res, 409, "Target is a directory");
      return;
    }
    log.error("files", "POST create: write threw", { pathPreview: previewSnippet(relPath), error: errorMessage(err) });
    serverError(res, "Failed to create file");
    return;
  }
  const fresh = await statSafeAsync(resolved.absPath);
  log.info("files", "POST create: ok", {
    pathPreview: previewSnippet(relPath),
    bytes: fresh?.size ?? contentBytes,
  });
  void publishFileChange(relPath);
  res.json({
    path: relPath,
    size: fresh?.size ?? contentBytes,
    modifiedMs: fresh?.mtimeMs ?? Date.now(),
  });
});

router.put(API_ROUTES.files.content, async (req: Request<object, unknown, WriteContentRequest>, res: Response<WriteContentResponse | ErrorResponse>) => {
  const validation = validatePutContentRequest(req.body);
  if (!validation.ok) {
    log.warn("files", validation.logMsg, validation.logExtra);
    badRequest(res, validation.message);
    return;
  }
  const { relPath, content, bytes: contentBytes } = validation;
  log.info("files", "PUT content: start", { pathPreview: previewSnippet(relPath), bytes: contentBytes });

  const resolved = await resolveExistingTextFile(relPath);
  if (!resolved.ok) {
    if (resolved.status === 404) notFound(res, resolved.message);
    else badRequest(res, resolved.message);
    return;
  }
  const jsonError = jsonSyntaxError(relPath, content);
  if (jsonError !== null) {
    log.warn("files", "PUT content: invalid JSON", { pathPreview: previewSnippet(relPath) });
    badRequest(res, jsonError);
    return;
  }
  try {
    await writeFileContent(resolved.absPath, content);
  } catch (err) {
    log.error("files", "PUT content: write threw", { pathPreview: previewSnippet(relPath), error: errorMessage(err) });
    serverError(res, "Failed to write file");
    return;
  }
  const fresh = await statSafeAsync(resolved.absPath);
  log.info("files", "PUT content: ok", {
    pathPreview: previewSnippet(relPath),
    bytes: fresh?.size ?? contentBytes,
  });
  // Notify subscribers + run side-effect hooks (e.g. memory topic
  // index regeneration in #1032). Fire-and-forget; the publisher
  // logs failures internally and the user-facing write already
  // succeeded.
  void publishFileChange(relPath);
  res.json({
    path: relPath,
    size: fresh?.size ?? contentBytes,
    modifiedMs: fresh?.mtimeMs ?? Date.now(),
  });
});

router.get(API_ROUTES.files.raw, (req: Request<object, unknown, unknown, PathQuery>, res: Response<ErrorResponse>) => {
  const requestedPath = getOptionalStringQuery(req, "path") ?? "";
  log.info("files", "GET raw: start", { pathPreview: previewSnippet(requestedPath) });
  const ctx = resolveAndStatFile(req, res);
  if (!ctx) {
    log.warn("files", "GET raw: gated by resolve/stat", { pathPreview: previewSnippet(requestedPath) });
    return;
  }
  const { absPath, stat } = ctx;

  const rawKind = classify(absPath);
  const rawSizeCap = rawKind === "audio" || rawKind === "video" ? MAX_MEDIA_BYTES : MAX_RAW_BYTES;
  if (stat.size > rawSizeCap) {
    log.warn("files", "GET raw: too large", { pathPreview: previewSnippet(requestedPath), bytes: stat.size, cap: rawSizeCap });
    sendError(res, 413, `File too large to stream (${stat.size} bytes, limit ${rawSizeCap})`);
    return;
  }
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mime);
  // Sandbox the response so an `.svg` / `.html` with embedded
  // JavaScript can't escape into the localhost:3001 origin via
  // direct navigation or <iframe>. PDFs get a narrower header set
  // (no sandbox CSP) because Safari/WebKit refuses to render
  // sandbox-opaque PDFs (#1299). See plans/done/
  // fix-files-raw-csp-sandbox.md for the full threat model.
  applyRawSecurityHeaders(res, mime);

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
    pipeWithErrorHandling(createReadStream(absPath, { start: range.start, end: range.end }), res);
    return;
  }

  res.setHeader("Content-Length", String(stat.size));
  pipeWithErrorHandling(createReadStream(absPath), res);
});

// ── Reference directory roots ───────────────────────────────────
//
// Returns configured reference directories as top-level TreeNode[]
// for the file explorer. Each node's path uses the @ref/<label>
// prefix so subsequent /dir and /content requests route correctly.

// GET /api/files/preview-raw?path=<rel> — stream the server-converted
// PDF preview of a .pptx file (#1985). Path validation mirrors every
// other files route; refuses when the target isn't a pptx or when
// LibreOffice isn't available for conversion. Cached on disk under
// `os.tmpdir()/mulmoclaude-office-preview/` so re-opens don't re-run
// LibreOffice.
router.get(API_ROUTES.files.previewRaw, async (req: Request<object, unknown, unknown, PathQuery>, res: Response<ErrorResponse>) => {
  const ctx = resolveAndStatFile(req, res);
  if (!ctx) return;
  const { absPath } = ctx;
  if (officeKind(absPath) !== "office-pptx") {
    notFound(res, "preview-raw is only available for .pptx files");
    return;
  }
  const pdfPath = await previewPptxAsPdf(absPath);
  if (!pdfPath) {
    notFound(res, "pptx preview not available (LibreOffice missing or conversion failed)");
    return;
  }
  res.setHeader("Content-Type", "application/pdf");
  createReadStream(pdfPath).pipe(res);
});

// POST /api/files/open — ask the host OS to open the file in its
// default application / file manager (#1985). Cross-platform: macOS
// `open`, Linux `xdg-open`, Windows `start`. Workspace-scoped path
// validation mirrors every other files route. Fire-and-forget: we
// return once the subprocess has been spawned; anything the OS does
// afterwards is out of our hands (and the user's problem).
interface OpenFileRequest {
  path?: unknown;
}
router.post(API_ROUTES.files.open, async (req: Request<object, unknown, OpenFileRequest>, res: Response<{ ok: boolean } | ErrorResponse>) => {
  const requestedPath = typeof req.body?.path === "string" ? req.body.path : "";
  if (!requestedPath) {
    badRequest(res, "path required");
    return;
  }
  // Reuse the same resolve+stat gate as /content. Set the path onto
  // the query object so `resolveAndStatFile` (which reads from the
  // query) accepts the POST body's path.
  (req.query as PathQuery).path = requestedPath;
  const ctx = resolveAndStatFile(req, res);
  if (!ctx) return;
  const { absPath } = ctx;
  const { platform } = process;
  try {
    if (platform === "darwin") {
      await execFileAsync("open", [absPath], { timeout: SUBPROCESS_PROBE_TIMEOUT_MS });
    } else if (platform === "win32") {
      // `start` is a cmd built-in; the empty "" is a title placeholder
      // required when the target path is quoted (else cmd interprets
      // the first quoted arg as the window title, not the file).
      await execFileAsync("cmd", ["/c", "start", "", absPath], { timeout: SUBPROCESS_PROBE_TIMEOUT_MS });
    } else {
      await execFileAsync("xdg-open", [absPath], { timeout: SUBPROCESS_PROBE_TIMEOUT_MS });
    }
    res.json({ ok: true });
  } catch (err) {
    log.warn("files", "POST open: spawn failed", { platform, error: errorMessage(err) });
    serverError(res, `Failed to open file in OS: ${errorMessage(err)}`);
  }
});

router.get(API_ROUTES.files.refRoots, async (_req: Request, res: Response<TreeNode[]>) => {
  log.info("files", "GET ref-roots: start");
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
  log.info("files", "GET ref-roots: ok", { configured: entries.length, mounted: nodes.length });
  res.json(nodes);
});

export default router;
