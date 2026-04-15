import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME } from "./definition";
import type { MarkdownToolData } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";

const markdownPlugin: ToolPlugin<MarkdownToolData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<MarkdownToolData>>(
      "/api/present-document",
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
  generatingMessage: "Creating document...",
  viewComponent: View,
  previewComponent: Preview,
};

export default markdownPlugin;
export { TOOL_NAME };
