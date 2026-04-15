// Public API for the skills module. Discovery (read-only) is phase
// 0; save + delete (project scope only) is phase 1.

export { discoverSkills, collectSkillsFromDir } from "./discovery.js";
export { parseSkillFrontmatter } from "./parser.js";
export { saveProjectSkill, deleteProjectSkill } from "./writer.js";
export type { SaveResult, DeleteResult } from "./writer.js";
export {
  isValidSlug,
  projectSkillsDir,
  projectSkillPath,
  projectSkillDir,
} from "./paths.js";
export type { Skill, SkillSource, SkillSummary } from "./types.js";
