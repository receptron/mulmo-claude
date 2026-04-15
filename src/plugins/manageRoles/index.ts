import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition from "./definition";
import { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";

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
    const result = await apiPost<ToolResult<ManageRolesData>>(
      "/api/roles/manage",
      args,
    );
    if (!result.ok) {
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        message: result.error,
      };
    }
    return {
      ...result.data,
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
