// Domain I/O: HTML scratch buffer
//   artifacts/html-scratch/current.html
//
// Optional `root` for test DI.

import path from "node:path";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { readTextUnder, writeTextUnder } from "./workspace-io.js";

const HTML_REL = path.posix.join(WORKSPACE_DIRS.html, "current.html");
const root = (r?: string) => r ?? workspacePath;

export async function readCurrentHtml(r?: string): Promise<string | null> {
  return readTextUnder(root(r), HTML_REL);
}

export async function writeCurrentHtml(html: string, r?: string): Promise<void> {
  await writeTextUnder(root(r), HTML_REL, html);
}
