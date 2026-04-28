import { readFile } from "fs/promises";
import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";
import { buildArtifactPathRandom } from "./naming.js";

// Random-id suffix prevents collisions between concurrent writers sharing a prefix; #764 sharded under YYYY/MM.
export async function saveMarkdown(content: string, prefix: string): Promise<string> {
  const relPath = buildArtifactPathRandom(WORKSPACE_DIRS.markdowns, prefix, ".md", "document");
  const absPath = path.join(workspacePath, relPath);
  await writeFileAtomic(absPath, content);
  return relPath;
}

export async function loadMarkdown(relativePath: string): Promise<string> {
  const absPath = path.join(workspacePath, relativePath);
  return readFile(absPath, "utf-8");
}

export async function overwriteMarkdown(relativePath: string, content: string): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await writeFileAtomic(absPath, content);
}

// Strict — overwriteMarkdown's path.join doesn't normalize traversal, so this gate is the primary defence.
export function isMarkdownPath(value: string): boolean {
  if (!value.startsWith(`${WORKSPACE_DIRS.markdowns}/`)) return false;
  if (!value.endsWith(".md")) return false;
  const normalized = path.posix.normalize(value);
  if (normalized !== value) return false;
  if (normalized.includes("..")) return false;
  return true;
}
