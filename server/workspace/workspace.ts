import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../system/logger/index.js";
import {
  EAGER_WORKSPACE_DIRS,
  WORKSPACE_FILES,
  WORKSPACE_PATHS,
  workspacePath,
} from "./paths.js";
import {
  existsInWorkspace,
  writeWorkspaceTextSync,
} from "../utils/files/workspace-io.js";
import { loadCustomDirs, ensureCustomDirs } from "./custom-dirs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "helps");

// Re-exported so existing callers (`import { workspacePath } from
// "./workspace.js"`) keep working. See workspace-paths.ts for the
// definitive source.
export { workspacePath };

// Must exist before downstream modules call realpathSync(workspacePath) at their own module-load time.
fs.mkdirSync(workspacePath, { recursive: true });

export function initWorkspace(): string {
  // Create directory structure if needed
  for (const key of EAGER_WORKSPACE_DIRS) {
    fs.mkdirSync(WORKSPACE_PATHS[key], { recursive: true });
  }

  // Create memory.md if it doesn't exist
  if (!existsInWorkspace(WORKSPACE_FILES.memory)) {
    writeWorkspaceTextSync(
      WORKSPACE_FILES.memory,
      "# Memory\n\nDistilled facts about you and your work.\n",
    );
  }

  // Always sync all files from server/helps/ into workspace/helps/
  fs.mkdirSync(WORKSPACE_PATHS.helps, { recursive: true });
  for (const file of fs.readdirSync(TEMPLATES_DIR)) {
    fs.copyFileSync(
      path.join(TEMPLATES_DIR, file),
      path.join(WORKSPACE_PATHS.helps, file),
    );
  }

  // Create .gitignore if missing. The workspace is a git repo for
  // version-tracking user data, but cloned dev repos under github/
  // have their own .git and shouldn't be committed (#256).
  if (!existsInWorkspace(".gitignore")) {
    writeWorkspaceTextSync(
      ".gitignore",
      [
        "# Cloned repositories have their own .git — don't nest",
        "github/",
        "",
        "# Auth token (regenerated each startup)",
        ".session-token",
        "",
      ].join("\n"),
    );
  }

  // User-defined custom directories (#239)
  const customDirs = loadCustomDirs();
  if (customDirs.length > 0) {
    ensureCustomDirs(customDirs);
    log.info("workspace", "custom directories loaded", {
      count: customDirs.length,
    });
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
