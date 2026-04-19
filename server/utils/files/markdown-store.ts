import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_DIRS, WORKSPACE_PATHS } from "../../workspace/paths.js";

/** Save markdown content as a file. Returns the workspace-relative path. */
export async function saveMarkdown(content: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const filename = `${id}.md`;
  await fs.writeFile(
    path.join(WORKSPACE_PATHS.markdowns, filename),
    content,
    "utf-8",
  );
  return path.posix.join(WORKSPACE_DIRS.markdowns, filename);
}

/** Read a markdown file and return its content. */
export async function loadMarkdown(relativePath: string): Promise<string> {
  const absPath = path.join(workspacePath, relativePath);
  return fs.readFile(absPath, "utf-8");
}

/** Overwrite an existing markdown file. */
export async function overwriteMarkdown(
  relativePath: string,
  content: string,
): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await fs.writeFile(absPath, content, "utf-8");
}

/** Check if a string is a markdown file path (not inline content). */
export function isMarkdownPath(value: string): boolean {
  return (
    value.startsWith(`${WORKSPACE_DIRS.markdowns}/`) && value.endsWith(".md")
  );
}
