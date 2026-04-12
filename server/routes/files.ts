import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../workspace.js";
import { statSafe, readDirSafe, resolveWithinRoot } from "../utils/fs.js";
import { errorMessage } from "../utils/errors.js";

const router = Router();

const MAX_PREVIEW_BYTES = 1024 * 1024; // 1 MB — text content embedded in JSON
const MAX_RAW_BYTES = 50 * 1024 * 1024; // 50 MB — cap for binary streaming
const HIDDEN_DIRS = new Set([".git"]);

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
  ".env",
  ".gitignore",
  ".sh",
  ".py",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".oga",
  ".flac",
  ".aac",
]);

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

interface FileContentMeta {
  kind: "image" | "pdf" | "audio" | "video" | "binary" | "too-large";
  path: string;
  size: number;
  modifiedMs: number;
  message?: string;
}

type FileContentResponse = FileContentText | FileContentMeta;

type ContentKind = "text" | "image" | "pdf" | "audio" | "video" | "binary";

function classify(filename: string): ContentKind {
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
// hidden-dir traversal check (e.g. `.git/config`). buildTree already
// hides these from the listing, but the URL endpoints are reachable
// directly so they need their own check.
function resolveSafe(relPath: string): string | null {
  const resolved = resolveWithinRoot(workspaceReal, relPath);
  if (!resolved) return null;
  const relativeFromWorkspace = path.relative(workspaceReal, resolved);
  if (relativeFromWorkspace) {
    for (const seg of relativeFromWorkspace.split(path.sep)) {
      if (HIDDEN_DIRS.has(seg)) return null;
    }
  }
  return resolved;
}

interface ByteRange {
  start: number;
  end: number;
}

// Parse an HTTP Range header of the form `bytes=START-END` or
// `bytes=-SUFFIX`. Returns null for malformed or unsatisfiable ranges
// so the caller can respond 416. We deliberately reject multi-range
// requests (`bytes=0-99,200-299`) since browsers don't issue them for
// media playback and supporting them would complicate the response.
function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
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

// If the read stream errors mid-flight (file deleted, disk error,
// permissions changed), surface a clean failure to the client instead
// of leaving the connection hanging.
function pipeWithErrorHandling(
  stream: fs.ReadStream,
  res: Response<ErrorResponse>,
): void {
  stream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    res.status(500).json({ error: `Failed to read file: ${err.message}` });
  });
  stream.pipe(res);
}

function buildTree(absPath: string, relPath: string): TreeNode {
  const stat = fs.statSync(absPath);
  if (!stat.isDirectory()) {
    return {
      name: path.basename(absPath),
      path: relPath,
      type: "file",
      size: stat.size,
      modifiedMs: stat.mtimeMs,
    };
  }
  const entries = readDirSafe(absPath);
  const children: TreeNode[] = [];
  for (const entry of entries) {
    if (HIDDEN_DIRS.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue; // avoid escaping the workspace
    const childAbs = path.join(absPath, entry.name);
    const childRel = relPath ? path.join(relPath, entry.name) : entry.name;
    const childStat = statSafe(childAbs);
    if (!childStat) continue;
    children.push(buildTree(childAbs, childRel));
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    name: relPath ? path.basename(relPath) : "",
    path: relPath,
    type: "dir",
    modifiedMs: stat.mtimeMs,
    children,
  };
}

router.get(
  "/files/tree",
  (
    _req: Request<object, unknown, unknown, object>,
    res: Response<TreeNode | ErrorResponse>,
  ) => {
    try {
      const tree = buildTree(workspaceReal, "");
      res.json(tree);
    } catch (err) {
      res
        .status(500)
        .json({ error: `Failed to read workspace: ${errorMessage(err)}` });
    }
  },
);

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
    res.status(400).json({ error: "path required" });
    return null;
  }
  // Syntactic candidate (no symlink resolution yet).
  const candidate = path.resolve(workspaceReal, path.normalize(relPath));
  const stat = statSafe(candidate);
  if (!stat) {
    // Distinguish "missing file under workspace" (404) from "path
    // syntactically outside workspace" (400). We check the
    // syntactic relative form, NOT realpath, because the file
    // doesn't exist so realpath would throw anyway.
    const relativeFromWorkspace = path.relative(workspaceReal, candidate);
    const escapesSyntactically =
      relativeFromWorkspace === ".." ||
      relativeFromWorkspace.startsWith(`..${path.sep}`);
    if (escapesSyntactically) {
      res.status(400).json({ error: "Path outside workspace" });
    } else {
      res.status(404).json({ error: "File not found" });
    }
    return null;
  }
  if (!stat.isFile()) {
    res.status(400).json({ error: "Not a file" });
    return null;
  }
  // File exists — run the realpath-hardened check to defeat
  // symlink-escape attempts (e.g. workspace/secret → /etc/passwd).
  // resolveSafe also rejects paths that traverse a hidden dir.
  const absPath = resolveSafe(relPath);
  if (!absPath) {
    res.status(400).json({ error: "Path outside workspace" });
    return null;
  }
  return { relPath, absPath, stat };
}

router.get(
  "/files/content",
  (
    req: Request<object, unknown, unknown, PathQuery>,
    res: Response<FileContentResponse | ErrorResponse>,
  ) => {
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
    if (
      kind === "image" ||
      kind === "pdf" ||
      kind === "audio" ||
      kind === "video"
    ) {
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
      res
        .status(500)
        .json({ error: `Failed to read file: ${errorMessage(err)}` });
      return;
    }
    res.json({ kind: "text", ...meta, content });
  },
);

router.get(
  "/files/raw",
  (
    req: Request<object, unknown, unknown, PathQuery>,
    res: Response<ErrorResponse>,
  ) => {
    const ctx = resolveAndStatFile(req, res);
    if (!ctx) return;
    const { absPath, stat } = ctx;

    if (stat.size > MAX_RAW_BYTES) {
      res.status(413).json({
        error: `File too large to stream (${stat.size} bytes, limit ${MAX_RAW_BYTES})`,
      });
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", mime);

    // Range support is required for `<video>` playback (Safari refuses
    // to play media without 206 responses) and for seek-past-buffered
    // in `<audio>`. When no Range header is sent we fall through to
    // the existing full-file pipe.
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const range = parseRange(rangeHeader, stat.size);
      if (!range) {
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        res.status(416).json({ error: "Range not satisfiable" });
        return;
      }
      res.status(206);
      res.setHeader(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${stat.size}`,
      );
      res.setHeader("Content-Length", String(range.end - range.start + 1));
      pipeWithErrorHandling(
        fs.createReadStream(absPath, { start: range.start, end: range.end }),
        res,
      );
      return;
    }

    res.setHeader("Content-Length", String(stat.size));
    pipeWithErrorHandling(fs.createReadStream(absPath), res);
  },
);

export default router;
