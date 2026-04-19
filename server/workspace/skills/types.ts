// Shared Skill type. A Skill is the parsed content of one
// ~/.claude/skills/<name>/SKILL.md file (or the project-level
// equivalent under <workspace>/.claude/skills/<name>/SKILL.md).
//
// Phase 0 is read-only: the server discovers and exposes skills
// but never writes to them. Edits happen through the user's file
// system or other tooling (e.g. their own skills repo).

export type SkillSource = "user" | "project";

export interface Skill {
  /** Directory name under skills/, e.g. "ci_enable". */
  name: string;
  /** The `description` field from YAML frontmatter. Used as the
   *  one-line summary in the UI list. */
  description: string;
  /** Markdown body after the frontmatter. Passed to Claude when the
   *  user clicks "Run". */
  body: string;
  /** Which scope this skill was discovered in. Project overrides user
   *  when names collide. */
  source: SkillSource;
  /** Absolute path to the SKILL.md file (post-symlink resolve). Used
   *  to surface the origin in the detail view. */
  path: string;
}

/** Lightweight summary for list endpoints — omits the full body so
 *  GET /api/skills stays small even with many skills. */
export type SkillSummary = Pick<Skill, "name" | "description" | "source">;
