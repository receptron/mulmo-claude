// Scan the user's ~/.claude/skills/ and the workspace-level
// <workspace>/.claude/skills/ for SKILL.md files, parse them, and
// produce a deduped list. Project-level skills override user-level
// skills with the same name (mirrors settings precedence in #197).

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { log } from "../logger/index.js";
import { parseSkillFrontmatter } from "./parser.js";
import { SKILL_FILE, USER_SKILLS_DIR, projectSkillsDir } from "./paths.js";
import type { Skill, SkillSource } from "./types.js";

// One directory entry → a parsed Skill, or null when the entry is
// not a valid skill (no SKILL.md, malformed frontmatter, I/O error).
// Errors are logged at warn, not thrown — a single broken skill
// shouldn't take down the whole list.
async function readSkillDir(
  skillDir: string,
  name: string,
  source: SkillSource,
): Promise<Skill | null> {
  const skillPath = join(skillDir, SKILL_FILE);
  try {
    // Follow symlinks: stat rather than lstat so a user's
    // `pptx@ → ~/ss/llm/skills/pptx/` reads through the link.
    const fileStat = await stat(skillPath);
    if (!fileStat.isFile()) return null;
    const raw = await readFile(skillPath, "utf-8");
    const parsed = parseSkillFrontmatter(raw);
    if (!parsed) {
      log.warn("skills", "SKILL.md has no usable frontmatter, skipping", {
        name,
        path: skillPath,
      });
      return null;
    }
    return {
      name,
      description: parsed.description,
      body: parsed.body,
      source,
      path: skillPath,
    };
  } catch (err) {
    // ENOENT = SKILL.md missing. Anything else is logged so a
    // permissions issue is findable; we still treat the slot as
    // "not a skill" rather than failing the whole list.
    const error = err as { code?: string };
    if (error.code !== "ENOENT") {
      log.warn("skills", "failed to read SKILL.md, skipping", {
        name,
        path: skillPath,
        error: String(err),
      });
    }
    return null;
  }
}

/**
 * Scan one skills root (either the user or project location) and
 * return every valid Skill. The root itself is allowed to not exist
 * — we just return an empty list (a workspace with no .claude/skills/
 * is the common case).
 */
export async function collectSkillsFromDir(
  root: string,
  source: SkillSource,
): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (err) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") return [];
    log.warn("skills", "failed to list skills dir, returning empty", {
      root,
      error: String(err),
    });
    return [];
  }

  const results: Skill[] = [];
  for (const name of entries) {
    // Skip hidden entries (.DS_Store, .gitkeep, etc.) up front.
    if (name.startsWith(".")) continue;
    const skillDir = resolve(root, name);
    let dirStat;
    try {
      // stat follows symlinks — supports `ln -s target skills/name`.
      dirStat = await stat(skillDir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;
    const skill = await readSkillDir(skillDir, name, source);
    if (skill) results.push(skill);
  }
  // Stable alphabetical order for the UI.
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

export interface DiscoverSkillsOptions {
  /** Absolute path to the user's ~/.claude/skills/. Overridable for
   *  tests that point at mkdtempSync trees. */
  userDir?: string;
  /** Workspace root; project-level skills live at
   *  `<workspaceRoot>/.claude/skills/`. Passing undefined skips the
   *  project scope entirely. */
  workspaceRoot?: string;
}

/**
 * Discover every skill available to this workspace. Project-level
 * skills (under `<workspace>/.claude/skills/`) override user-level
 * skills of the same name.
 */
export async function discoverSkills(
  opts: DiscoverSkillsOptions = {},
): Promise<Skill[]> {
  const userDir = opts.userDir ?? USER_SKILLS_DIR;
  const userSkills = await collectSkillsFromDir(userDir, "user");

  const projectSkills = opts.workspaceRoot
    ? await collectSkillsFromDir(
        projectSkillsDir(opts.workspaceRoot),
        "project",
      )
    : [];

  // Project overrides user on name collision. Merge by building a
  // map keyed by name, starting with user, overwriting with project.
  const merged = new Map<string, Skill>();
  for (const s of userSkills) merged.set(s.name, s);
  for (const s of projectSkills) merged.set(s.name, s);

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
