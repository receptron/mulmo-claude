import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

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
    console.log(`Initialized git repository in ${workspacePath}`);
  }

  console.log(`Workspace: ${workspacePath}`);
  return workspacePath;
}
