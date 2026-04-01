import type { ToolPlugin } from "../../tools/types";
import toolDefinition from "./definition";
import { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";

export interface CustomRole {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  availablePlugins: string[];
  queries?: string[];
}

export interface ManageRolesData {
  customRoles: CustomRole[];
}

const manageRolesPlugin: ToolPlugin = {
  toolDefinition,
  async execute(_context, args) {
    const res = await fetch("/api/roles/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const result = await res.json();
    return {
      ...result,
      toolName: TOOL_NAME,
      uuid: crypto.randomUUID(),
    };
  },
  isEnabled: () => true,
  generatingMessage: "Managing roles…",
  viewComponent: View,
  previewComponent: Preview,
};

export default manageRolesPlugin;
export { TOOL_NAME };
