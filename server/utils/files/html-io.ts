import path from "node:path";
import { WORKSPACE_DIRS, workspacePath } from "../../workspace/paths.js";
import { readTextUnder, writeTextUnder } from "./workspace-io.js";

const HTML_REL = path.posix.join(WORKSPACE_DIRS.html, "current.html");
const root = (workspaceRoot?: string) => workspaceRoot ?? workspacePath;

export async function readCurrentHtml(workspaceRoot?: string): Promise<string | null> {
  return readTextUnder(root(workspaceRoot), HTML_REL);
}

export async function writeCurrentHtml(html: string, workspaceRoot?: string): Promise<void> {
  await writeTextUnder(root(workspaceRoot), HTML_REL, html);
}
