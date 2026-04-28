// Workspace provisioning for the LLM wiki-write hook (#763 PR 2 prereq).
//
// At server startup, ensure the workspace's `.claude/settings.json`
// has a `PostToolUse` hook on Write|Edit that runs our snapshot
// script. The script itself is rewritten from the source-of-truth
// constant in `hookScript.ts` on every startup so updates ship via
// the normal mulmoclaude code path — no per-workspace migration.
//
// Idempotent: running provisioning twice produces the same on-disk
// state. Existing user-supplied keys in `settings.json` are
// preserved; we only touch the one PostToolUse entry that we own
// (identified by a `mulmoclaudeWikiHistory: true` marker on the
// hook descriptor).

import path from "node:path";
import { readTextOrNull } from "../../utils/files/safe.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import { WIKI_SNAPSHOT_HOOK_SCRIPT } from "./hookScript.js";

const SETTINGS_REL = path.join(".claude", "settings.json");
const HOOK_SCRIPT_REL = path.join(".claude", "hooks", "wiki-snapshot.mjs");
// Forward-slash form for the shell command field — settings.json
// is read by Claude CLI, and a hook command is interpreted by a
// POSIX shell (Mac / Linux / inside the Docker container). We never
// embed the workspace root directly: the same settings.json is
// bind-mounted into the container, so a host-absolute path
// (`/Users/.../mulmoclaude/...`) silently fails inside the container
// where the workspace lives at `/home/node/mulmoclaude/...`. Claude
// CLI exports `CLAUDE_PROJECT_DIR` to hooks, which resolves
// correctly in both contexts.
const HOOK_SCRIPT_REL_POSIX = ".claude/hooks/wiki-snapshot.mjs";
const HOOK_COMMAND = `node "$CLAUDE_PROJECT_DIR/${HOOK_SCRIPT_REL_POSIX}"`;
const OWNER_MARKER = "mulmoclaudeWikiHistory";

interface HookCommandEntry {
  type: "command";
  command: string;
  [key: string]: unknown;
}

interface HookMatcher {
  matcher?: string;
  hooks?: HookCommandEntry[];
  [key: string]: unknown;
}

interface SettingsShape {
  hooks?: {
    PostToolUse?: HookMatcher[];
    [key: string]: HookMatcher[] | undefined;
  };
  [key: string]: unknown;
}

export interface ProvisionOptions {
  workspaceRoot?: string;
}

/** Ensure the hook script + `.claude/settings.json` are up to date.
 *  Safe to call on every startup. Logs a one-line info on first
 *  install, debug-only on subsequent no-op runs. */
export async function provisionWikiHistoryHook(opts: ProvisionOptions = {}): Promise<void> {
  const root = opts.workspaceRoot ?? defaultWorkspacePath;
  const scriptPath = path.join(root, HOOK_SCRIPT_REL);
  const settingsPath = path.join(root, SETTINGS_REL);

  await writeHookScript(scriptPath);
  const changed = await mergeHookIntoSettings(settingsPath);
  if (changed) {
    log.info("wiki-history", "provisioned wiki-snapshot hook", { settingsPath, scriptPath });
  }
}

async function writeHookScript(absPath: string): Promise<void> {
  // Always overwrite — the constant in `hookScript.ts` is the
  // source of truth, and rewriting on every startup means a
  // mulmoclaude update propagates without per-workspace migration.
  await writeFileAtomic(absPath, WIKI_SNAPSHOT_HOOK_SCRIPT, { mode: 0o700 });
}

async function mergeHookIntoSettings(settingsPath: string): Promise<boolean> {
  const existingRaw = await readTextOrNull(settingsPath);
  const existing: SettingsShape = existingRaw ? safeParse(existingRaw) : {};

  const desiredHook: HookCommandEntry = {
    type: "command",
    command: HOOK_COMMAND,
    [OWNER_MARKER]: true,
  };

  const next = upsertOurHook(existing, desiredHook);
  const nextRaw = `${JSON.stringify(next, null, 2)}\n`;
  if (existingRaw === nextRaw) return false;

  // mode 0644 is fine — settings.json doesn't carry secrets, and
  // matching the user's own conventions for `~/.claude/settings.json`
  // (which is typically world-readable) avoids permission surprises.
  await writeFileAtomic(settingsPath, nextRaw);
  return true;
}

function safeParse(raw: string): SettingsShape {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SettingsShape;
    }
  } catch {
    // Fall through — corrupted settings get rebuilt with our entry only.
  }
  return {};
}

function upsertOurHook(settings: SettingsShape, desiredHook: HookCommandEntry): SettingsShape {
  const hooks = settings.hooks ?? {};
  const postToolUse = hooks.PostToolUse ?? [];

  const ownedIndex = postToolUse.findIndex((entry) => entryHasOwnedHook(entry));
  const desiredEntry: HookMatcher = {
    matcher: "Write|Edit",
    hooks: [desiredHook],
  };

  const nextPostToolUse = [...postToolUse];
  if (ownedIndex === -1) {
    nextPostToolUse.push(desiredEntry);
  } else {
    nextPostToolUse[ownedIndex] = desiredEntry;
  }

  return {
    ...settings,
    hooks: {
      ...hooks,
      PostToolUse: nextPostToolUse,
    },
  };
}

function entryHasOwnedHook(entry: HookMatcher): boolean {
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook) => hook[OWNER_MARKER] === true);
}
