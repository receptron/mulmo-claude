import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../workspace.js";

const router = Router();

const MAX_PREVIEW_BYTES = 1024 * 1024; // 1 MB — text content embedded in JSON
const MAX_RAW_BYTES = 50 * 1024 * 1024; // 50 MB — cap for binary streaming
const HIDDEN_DIRS = new Set([".git"]);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".vue",
  ".html",
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

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
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
  kind: "image" | "pdf" | "binary" | "too-large";
  path: string;
  size: number;
  modifiedMs: number;
  message?: string;
}

type FileContentResponse = FileContentText | FileContentMeta;

type ContentKind = "text" | "image" | "pdf" | "binary";

function classify(filename: string): ContentKind {
  const ext = path.extname(filename).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  // Files with no extension (e.g. README, LICENSE) — treat as text
  if (!ext) return "text";
  return "binary";
}

// Realpath of the workspace, computed once at module load. Using the
// realpath defeats symlink-based escapes — `path.resolve` + `startsWith`
// alone is insufficient because a symlink inside the workspace could
// point at `/etc/passwd` and still pass the prefix check.
const workspaceReal = fs.realpathSync(workspacePath);

function resolveSafe(relPath: string): string | null {
  const normalized = path.normalize(relPath || "");
  const resolved = path.resolve(workspaceReal, normalized);
  let resolvedReal: string;
  try {
    resolvedReal = fs.realpathSync(resolved);
  } catch {
    return null;
  }
  if (
    resolvedReal !== workspaceReal &&
    !resolvedReal.startsWith(workspaceReal + path.sep)
  ) {
    return null;
  }
  // Reject paths that traverse a hidden directory (e.g. `.git/config`).
  // buildTree already hides these from the listing, but the URL endpoints
  // are reachable directly so they need their own check.
  const relativeFromWorkspace = path.relative(workspaceReal, resolvedReal);
  if (relativeFromWorkspace) {
    for (const seg of relativeFromWorkspace.split(path.sep)) {
      if (HIDDEN_DIRS.has(seg)) return null;
    }
  }
  return resolvedReal;
}

function readDirSafe(absPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function statSafe(absPath: string): fs.Stats | null {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
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
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to read workspace: ${message}` });
    }
  },
);

interface PathQuery {
  path?: string;
}

router.get(
  "/files/content",
  (
    req: Request<object, unknown, unknown, PathQuery>,
    res: Response<FileContentResponse | ErrorResponse>,
  ) => {
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!relPath) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const absPath = resolveSafe(relPath);
    if (!absPath) {
      res.status(400).json({ error: "Path outside workspace" });
      return;
    }
    const stat = statSafe(absPath);
    if (!stat) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (!stat.isFile()) {
      res.status(400).json({ error: "Not a file" });
      return;
    }

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
    if (kind === "image" || kind === "pdf") {
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
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to read file: ${message}` });
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
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!relPath) {
      res.status(400).json({ error: "path required" });
      return;
    }
    const absPath = resolveSafe(relPath);
    if (!absPath) {
      res.status(400).json({ error: "Path outside workspace" });
      return;
    }
    const stat = statSafe(absPath);
    if (!stat) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (!stat.isFile()) {
      res.status(400).json({ error: "Not a file" });
      return;
    }
    if (stat.size > MAX_RAW_BYTES) {
      res.status(413).json({
        error: `File too large to stream (${stat.size} bytes, limit ${MAX_RAW_BYTES})`,
      });
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", String(stat.size));
    const stream = fs.createReadStream(absPath);
    // If the read stream errors mid-flight (file deleted, disk error,
    // permissions changed), surface a clean failure to the client
    // instead of leaving the connection hanging.
    stream.on("error", (err) => {
      if (res.headersSent) {
        res.destroy(err);
        return;
      }
      res.status(500).json({ error: `Failed to read file: ${err.message}` });
    });
    stream.pipe(res);
  },
);

export default router;
