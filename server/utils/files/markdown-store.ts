import { readFile } from "fs/promises";
import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import { buildArtifactPathRandom } from "./naming.js";

/**
 * Save markdown content as a file. Returns the workspace-relative path.
 * `prefix` is slugified; a random id is always appended to prevent
 * collisions between concurrent writers sharing the same prefix.
 *
 * `buildArtifactPathRandom` injects a `YYYY/MM` partition (#764) and
 * `writeFileAtomic` creates missing parents itself, so callers don't
 * need a separate `mkdir` step.
 *
 * Atomic: a crashed write can't leave a half-written .md (#881 v1).
 */
export async function saveMarkdown(content: string, prefix: string): Promise<string> {
  const relPath = buildArtifactPathRandom(WORKSPACE_DIRS.markdowns, prefix, ".md", "document");
  const absPath = path.join(workspacePath, relPath);
  await writeFileAtomic(absPath, content);
  return relPath;
}

/** Read a markdown file and return its content. */
export async function loadMarkdown(relativePath: string): Promise<string> {
  const absPath = path.join(workspacePath, relativePath);
  return readFile(absPath, "utf-8");
}

/** Overwrite an existing markdown file. Atomic — see {@link saveMarkdown}. */
export async function overwriteMarkdown(relativePath: string, content: string): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await writeFileAtomic(absPath, content);
}

/** Check if a string is a markdown file path (not inline content).
 *  Rejects traversal attempts like `artifacts/documents/../outside.md`
 *  so callers can rely on prefix+suffix alone. Mirrors the
 *  `isSpreadsheetPath` policy. The server-side `path.join` in
 *  `overwriteMarkdown` does NOT normalize traversal on its own, so
 *  this gate is the primary defence — keep it strict. */
export function isMarkdownPath(value: string): boolean {
  if (!value.startsWith(`${WORKSPACE_DIRS.markdowns}/`)) return false;
  if (!value.endsWith(".md")) return false;
  const normalized = path.posix.normalize(value);
  if (normalized !== value) return false;
  if (normalized.includes("..")) return false;
  return true;
}
