import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import type { MulmoScript } from "mulmocast";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";

export interface MulmoScriptData {
  script: MulmoScript;
  filePath: string;
}

const presentMulmoScriptPlugin: ToolPlugin<MulmoScriptData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<MulmoScriptData>>(
      "/api/mulmo-script",
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
  generatingMessage: "Generating MulmoScript storyboard…",
  viewComponent: View,
  previewComponent: Preview,
};

export default presentMulmoScriptPlugin;
