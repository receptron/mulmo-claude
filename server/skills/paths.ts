// Path helpers and slug validation for the skills module.
//
// Skills live in two scopes:
//   - user:    ~/.claude/skills/<slug>/SKILL.md        (read-only from MulmoClaude)
//   - project: <workspaceRoot>/.claude/skills/<slug>/SKILL.md  (MulmoClaude can CRUD)
//
// The slug doubles as a filename and appears in Claude CLI slash
// commands (`/<slug>`), so it has to be strict: no uppercase, no
// spaces, no path separators, no leading/trailing hyphens, 1-64
// chars. Same rule as `server/sources/paths.ts#isValidSlug` — keep
// them in sync manually.

import { homedir } from "node:os";
import { join } from "node:path";

export const SKILL_FILE = "SKILL.md";

/** `~/.claude/skills/` — user scope, read-only from MulmoClaude. */
export const USER_SKILLS_DIR = join(homedir(), ".claude", "skills");

/** `<workspaceRoot>/.claude/skills/` — project scope, writable. */
export function projectSkillsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".claude", "skills");
}

/** Full path to the project-scope SKILL.md for a given slug. */
export function projectSkillPath(workspaceRoot: string, slug: string): string {
  return join(projectSkillsDir(workspaceRoot), slug, SKILL_FILE);
}

/** Directory holding a project skill (one level above SKILL.md). */
export function projectSkillDir(workspaceRoot: string, slug: string): string {
  return join(projectSkillsDir(workspaceRoot), slug);
}

/**
 * Strict slug validator. Rejects anything that could surprise the
 * filesystem, the Claude CLI slash-command resolver, or the URL
 * parser. Single source of truth for `save` / `delete` input.
 */
export function isValidSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length === 0 || slug.length > 64) return false;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return false;
  if (slug.includes("--")) return false;
  return true;
}
