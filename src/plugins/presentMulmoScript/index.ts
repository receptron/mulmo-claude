import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import type { MulmoScript } from "mulmocast";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { makeUuid } from "../../utils/id";

export interface MulmoScriptData {
  script: MulmoScript;
  filePath: string;
}

const presentMulmoScriptPlugin: ToolPlugin<MulmoScriptData> = {
  toolDefinition,

  // Pass-through: the agent (MCP) and GUI dispatcher both end up at the
  // same backend route, which dispatches between create-new (`script`)
  // and reopen-existing (`filePath`) modes and handles the optional
  // `autoGenerateMovie` background trigger server-side. Keeping this
  // function trivial means the two callers can never drift apart.
  async execute(_context, args) {
    const result = await apiPost<ToolResult<MulmoScriptData>>(API_ROUTES.mulmoScript.save, args);
    if (!result.ok) {
      return {
        toolName: TOOL_NAME,
        uuid: makeUuid(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName: TOOL_NAME,
      uuid: makeUuid(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Generating MulmoScript storyboard…",
  viewComponent: View,
  previewComponent: Preview,
};

export default presentMulmoScriptPlugin;
