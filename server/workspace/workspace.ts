import { execSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "../system/logger/index.js";
import { EAGER_WORKSPACE_DIRS, WORKSPACE_PATHS, workspacePath } from "./paths.js";
import { readWorkspaceTextSync, writeWorkspaceTextSync } from "../utils/files/workspace-io.js";
import { loadCustomDirs, ensureCustomDirs } from "./custom-dirs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "helps");

// Re-exported so existing callers (`import { workspacePath } from
// "./workspace.js"`) keep working. See workspace-paths.ts for the
// definitive source.
export { workspacePath };

// Must exist before downstream modules call realpathSync(workspacePath) at their own module-load time.
mkdirSync(workspacePath, { recursive: true });

export function initWorkspace(): string {
  // Create directory structure if needed
  for (const key of EAGER_WORKSPACE_DIRS) {
    mkdirSync(WORKSPACE_PATHS[key], { recursive: true });
  }

  // Ensure the typed-memory directory exists (#1029). Individual
  // entry files are written by the agent or by the legacy-memory
  // migration; init just guarantees the directory is there so the
  // reader and migration both have a place to write to. The legacy
  // `conversations/memory.md` is no longer auto-created — migration
  // converts it on first start and the new layout becomes the source
  // of truth thereafter.
  mkdirSync(WORKSPACE_PATHS.memoryDir, { recursive: true });

  // Always sync all files from server/helps/ into workspace/helps/
  mkdirSync(WORKSPACE_PATHS.helps, { recursive: true });
  for (const file of readdirSync(TEMPLATES_DIR)) {
    copyFileSync(path.join(TEMPLATES_DIR, file), path.join(WORKSPACE_PATHS.helps, file));
  }

  // Create .gitignore if missing. The workspace is a git repo for
  // version-tracking user data, but cloned dev repos under github/
  // have their own .git and shouldn't be committed (#256). Runtime
  // files (`.session-token`, `.server-port`) are regenerated on
  // every startup and should never be committed (#917).
  ensureWorkspaceGitignore();

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
  if (!existsSync(gitDir)) {
    execSync("git init", { cwd: workspacePath });
    log.info("workspace", "initialized git repository", { workspacePath });
  }

  log.info("workspace", "ready", { workspacePath });
  return workspacePath;
}

export const REQUIRED_GITIGNORE_LINES = [
  "github/", // cloned repos have their own .git
  ".session-token", // bearer token regenerated each startup
  ".server-port", // runtime port published for the LLM wiki-write hook
] as const;

const FRESH_GITIGNORE = [
  "# Cloned repositories have their own .git — don't nest",
  "github/",
  "",
  "# Auth token (regenerated each startup)",
  ".session-token",
  "",
  "# Bound port published at startup for the wiki-write hook",
  ".server-port",
  "",
].join("\n");

/** Decide what `.gitignore` should look like given its current
 *  content. Returns null when no rewrite is needed.
 *  - `null` existing → fresh template
 *  - existing missing required lines → existing + missing lines
 *    appended (preserves user customisation)
 *  - existing with all required lines → null (no change) */
export function nextGitignoreContent(existing: string | null): string | null {
  if (existing === null) return FRESH_GITIGNORE;
  // Treat the file as line-oriented; ignore comments and blanks for
  // the comparison so a user's annotated copy still counts as
  // having the line.
  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((raw) => raw.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  const missing = REQUIRED_GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) return null;
  const trailingNewline = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${trailingNewline}${missing.join("\n")}\n`;
}

function ensureWorkspaceGitignore(): void {
  const existing = readWorkspaceTextSync(".gitignore");
  const next = nextGitignoreContent(existing);
  if (next === null) return;
  writeWorkspaceTextSync(".gitignore", next);
}
