import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { writeFileAtomic } from "./atomic.js";

export async function overwriteHtml(relativePath: string, content: string): Promise<void> {
  const absPath = path.join(workspacePath, relativePath);
  await writeFileAtomic(absPath, content);
}

// Strict — overwriteHtml's path.join doesn't normalize traversal, so this gate is the primary defence.
export function isHtmlPath(value: string): boolean {
  if (!value.startsWith(`${WORKSPACE_DIRS.htmls}/`)) return false;
  if (!value.endsWith(".html")) return false;
  const normalized = path.posix.normalize(value);
  if (normalized !== value) return false;
  if (normalized.includes("..")) return false;
  return true;
}
