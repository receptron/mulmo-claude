import fs from "fs/promises";
import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { buildArtifactPathRandom } from "./naming.js";

/**
 * Save markdown content as a file. Returns the workspace-relative path.
 * `prefix` is slugified; a random id is always appended to prevent
 * collisions between concurrent writers sharing the same prefix.
 */
export async function saveMarkdown(content: string, prefix: string): Promise<string> {
  const relPath = buildArtifactPathRandom(WORKSPACE_DIRS.markdowns, prefix, ".md", "document");
  await fs.writeFile(path.join(workspacePath, relPath), content, "utf-8");
  return relPath;
}

/** Read a markdown file and return its content. */
export async function loadMarkdown(relativePath: string): Promise<string> {
  const absPath = path.join(workspacePath, relativePath);
  return fs.readFile(absPath, "utf-8");
}

/** Overwrite an existing markdown file. */
export async function overwriteMarkdown(relativePath: string, content: string): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await fs.writeFile(absPath, content, "utf-8");
}

/** Check if a string is a markdown file path (not inline content). */
export function isMarkdownPath(value: string): boolean {
  return value.startsWith(`${WORKSPACE_DIRS.markdowns}/`) && value.endsWith(".md");
}
