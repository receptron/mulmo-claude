import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "helps");

export const workspacePath = path.join(os.homedir(), "mulmoclaude");

// Must exist before downstream modules call realpathSync(workspacePath) at their own module-load time.
fs.mkdirSync(workspacePath, { recursive: true });

const SUBDIRS = [
  "chat",
  "todos",
  "calendar",
  "contacts",
  "scheduler",
  "roles",
  "stories",
  "images",
  "markdowns",
  "spreadsheets",
  // Chart documents saved by the `presentChart` plugin. One file per
  // invocation; each file can hold multiple charts.
  "charts",
  // Web-configurable settings (app-wide) and user-defined MCP servers
  // live under this dir so future import/export can ship them as a
  // unit. See plans/done/feat-web-settings-ui.md.
  "configs",
];

export function initWorkspace(): string {
  // Create directory structure if needed
  for (const dir of SUBDIRS) {
    fs.mkdirSync(path.join(workspacePath, dir), { recursive: true });
  }

  // Create memory.md if it doesn't exist
  const memoryFile = path.join(workspacePath, "memory.md");
  if (!fs.existsSync(memoryFile)) {
    fs.writeFileSync(
      memoryFile,
      "# Memory\n\nDistilled facts about you and your work.\n",
    );
  }

  // Always sync all files from server/helps/ into workspace/helps/
  const helpsDestDir = path.join(workspacePath, "helps");
  fs.mkdirSync(helpsDestDir, { recursive: true });
  for (const file of fs.readdirSync(TEMPLATES_DIR)) {
    fs.copyFileSync(
      path.join(TEMPLATES_DIR, file),
      path.join(helpsDestDir, file),
    );
  }

  // Git init if not already a repo
  const gitDir = path.join(workspacePath, ".git");
  if (!fs.existsSync(gitDir)) {
    execSync("git init", { cwd: workspacePath });
    log.info("workspace", "initialized git repository", { workspacePath });
  }

  log.info("workspace", "ready", { workspacePath });
  return workspacePath;
}
