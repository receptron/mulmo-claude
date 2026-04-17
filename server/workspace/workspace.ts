import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../system/logger/index.js";
import {
  EAGER_WORKSPACE_DIRS,
  WORKSPACE_PATHS,
  workspacePath,
} from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "helps");

// Re-exported so existing callers (`import { workspacePath } from
// "./workspace.js"`) keep working. See workspace-paths.ts for the
// definitive source.
export { workspacePath };

// Must exist before downstream modules call realpathSync(workspacePath) at their own module-load time.
fs.mkdirSync(workspacePath, { recursive: true });

// Legacy (pre-#284) top-level directory names. If any of these still
// exist at the workspace root, the workspace hasn't been migrated to
// the new layout yet and the server must refuse to start — running
// against the pre-migration tree with the new constants would write
// new sessions to empty dirs and leave the old data stranded.
//
// Full migration is a one-shot operation (`scripts/migrate-workspace-284.ts`).
// The list must cover every DIR_MIGRATIONS.from entry in that script;
// a workspace that has ANY of these present still needs migration.
const LEGACY_TOP_LEVEL_DIRS_PRE_284 = [
  "HTMLs",
  "calendar",
  "charts",
  "chat",
  "configs",
  "contacts",
  "helps",
  "html",
  "images",
  "markdowns",
  "news",
  "roles",
  "scheduler",
  "scripts",
  "searches",
  "sources",
  "spreadsheets",
  "stories",
  "summaries",
  "todos",
  "transports",
  "wiki",
] as const;

function assertPost284Layout(): void {
  const legacyPresent = LEGACY_TOP_LEVEL_DIRS_PRE_284.filter((name) =>
    fs.existsSync(path.join(workspacePath, name)),
  );
  if (legacyPresent.length === 0) return;

  const msg =
    `Workspace at ${workspacePath} still has pre-#284 directories: ` +
    legacyPresent.join(", ") +
    `.\nRun the migration before starting the server:\n` +
    `  yarn tsx scripts/migrate-workspace-284.ts --dry-run   # preview\n` +
    `  yarn tsx scripts/migrate-workspace-284.ts --execute   # commit\n` +
    `See issue #284 for details.`;
  log.error("workspace", msg);
  throw new Error(
    "Workspace layout is pre-#284. Run scripts/migrate-workspace-284.ts first.",
  );
}

export function initWorkspace(): string {
  assertPost284Layout();

  // Create directory structure if needed
  for (const key of EAGER_WORKSPACE_DIRS) {
    fs.mkdirSync(WORKSPACE_PATHS[key], { recursive: true });
  }

  // Create memory.md if it doesn't exist
  if (!fs.existsSync(WORKSPACE_PATHS.memory)) {
    fs.writeFileSync(
      WORKSPACE_PATHS.memory,
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
  const gitignorePath = path.join(workspacePath, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(
      gitignorePath,
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

  // Git init if not already a repo
  const gitDir = path.join(workspacePath, ".git");
  if (!fs.existsSync(gitDir)) {
    execSync("git init", { cwd: workspacePath });
    log.info("workspace", "initialized git repository", { workspacePath });
  }

  log.info("workspace", "ready", { workspacePath });
  return workspacePath;
}
