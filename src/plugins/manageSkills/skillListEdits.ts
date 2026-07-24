import type { SkillSummary } from "./index";

// Immutable sidebar-list edits. The View seeds its local list from the
// shared tool-result array, so in-place `splice`/index-assignment would
// rewrite the stored result (and the Preview / chat export that read it).
// These return fresh arrays and never touch the input.

export const updateSkillDescription = (skills: readonly SkillSummary[], name: string, description: string): SkillSummary[] =>
  skills.map((skill) => (skill.name === name ? { ...skill, description } : skill));

export const removeSkillByName = (skills: readonly SkillSummary[], name: string): SkillSummary[] => skills.filter((skill) => skill.name !== name);
