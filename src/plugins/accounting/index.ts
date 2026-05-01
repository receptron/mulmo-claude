import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";
import { makeUuid } from "../../utils/id";

// MulmoClaude never invokes `execute()` at runtime (see ToolPlugin
// contract in src/tools/types.ts) — Claude → MCP → REST goes
// straight to /api/accounting. The implementation is kept as a
// one-line passthrough to satisfy the gui-chat-protocol shape.
export type AccountingActionData = Record<string, unknown>;

const accountingPlugin: ToolPlugin<AccountingActionData> = {
  toolDefinition,

  async execute(_context, args) {
    const toolName = toolDefinition.name;
    const result = await apiPost<ToolResult<AccountingActionData>>(API_ROUTES.accounting.dispatch, args);
    if (!result.ok) {
      return {
        toolName,
        uuid: makeUuid(),
        message: result.error,
      };
    }
    return {
      ...result.data,
      toolName,
      uuid: result.data.uuid ?? makeUuid(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Working on the books...",
  viewComponent: View,
  previewComponent: Preview,
};

export default accountingPlugin;
