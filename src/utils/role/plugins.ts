// Pure helpers for role → plugin queries.
// Takes the role list as a parameter for testability.

import type { Role } from "../../config/roles";
import { TOOL_NAMES, type ToolName } from "../../config/toolNames";

const GEMINI_PLUGINS = new Set<ToolName>([TOOL_NAMES.generateImage, TOOL_NAMES.presentDocument]);

/** Whether the given role uses any plugin that requires a Gemini API key. */
export function needsGemini(roles: Role[], roleId: string): boolean {
  return (roles.find((role) => role.id === roleId)?.availablePlugins ?? []).some((plugin) => GEMINI_PLUGINS.has(plugin));
}
