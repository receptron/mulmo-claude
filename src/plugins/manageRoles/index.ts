import type { ToolPlugin } from "../../tools/types";
import { toolDefinition, TOOL_NAME } from "./definition";
import TextResponsePlugin from "@gui-chat-plugin/text-response/vue";

// manageRoles has no custom canvas view — reuse text-response rendering
const manageRolesPlugin: ToolPlugin = {
  toolDefinition: toolDefinition as unknown as ToolPlugin["toolDefinition"],
  viewComponent: (TextResponsePlugin.plugin as unknown as ToolPlugin)
    .viewComponent,
  previewComponent: (TextResponsePlugin.plugin as unknown as ToolPlugin)
    .previewComponent,
};

export default manageRolesPlugin;
export { TOOL_NAME };
