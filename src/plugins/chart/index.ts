import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";

export interface ChartEntry {
  title?: string;
  type?: string;
  option: Record<string, unknown>;
}

export interface ChartDocument {
  title?: string;
  charts: ChartEntry[];
}

export interface PresentChartData {
  document: ChartDocument;
  title?: string;
  filePath: string;
}

const presentChartPlugin: ToolPlugin<PresentChartData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<PresentChartData>>(
      "/api/present-chart",
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
  generatingMessage: "Rendering chart…",
  viewComponent: View,
  previewComponent: Preview,
};

export default presentChartPlugin;
export { TOOL_NAME };
