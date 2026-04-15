import type { ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiGet } from "../../utils/api";

export interface SkillSummary {
  name: string;
  description: string;
  source: "user" | "project";
}

export interface ManageSkillsData {
  skills: SkillSummary[];
}

const manageSkillsPlugin: ToolPlugin<ManageSkillsData> = {
  toolDefinition,
  async execute() {
    // Claude invokes this tool to show the user their skills list.
    // The server exposes GET /api/skills (discovery + merge); we just
    // shape it for the View component.
    const result = await apiGet<{ skills: SkillSummary[] }>("/api/skills");
    if (!result.ok) {
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        message: `Failed to load skills: ${result.error}`,
        error: `Failed to load skills: ${result.error}`,
      };
    }
    const skills = result.data.skills;
    return {
      toolName: TOOL_NAME,
      uuid: crypto.randomUUID(),
      title: "Skills",
      message: `Found ${skills.length} skill${skills.length === 1 ? "" : "s"}.`,
      data: { skills },
    };
  },
  isEnabled: () => true,
  generatingMessage: "Loading skills…",
  viewComponent: View,
  previewComponent: Preview,
};

export default manageSkillsPlugin;
export { TOOL_NAME };
