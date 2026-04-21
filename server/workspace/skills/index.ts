// Public API for the skills module. Discovery (read-only) is phase
// 0; save + delete (project scope only) is phase 1.

export { discoverSkills, collectSkillsFromDir } from "./discovery.js";
export { parseSkillFrontmatter } from "./parser.js";
export { saveProjectSkill, updateProjectSkill, deleteProjectSkill } from "./writer.js";
export type { SaveResult, UpdateResult, DeleteResult } from "./writer.js";
export { isValidSlug } from "../../utils/slug.js";
export { projectSkillsDir, projectSkillPath, projectSkillDir } from "./paths.js";
export type { Skill, SkillSource, SkillSummary } from "./types.js";
