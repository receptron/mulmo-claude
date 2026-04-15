import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";
import { apiPost } from "../../utils/api";

export interface WikiPageEntry {
  title: string;
  slug: string;
  description: string;
}

export interface WikiData {
  action: string;
  title: string;
  content: string;
  pageEntries?: WikiPageEntry[];
  pageName?: string;
}

const wikiPlugin: ToolPlugin<WikiData> = {
  toolDefinition,

  async execute(_context, args) {
    const result = await apiPost<ToolResult<WikiData>>("/api/wiki", args);
    if (!result.ok) {
      throw new Error(
        result.status === 0
          ? `Wiki request failed: ${result.error}`
          : `Wiki API error ${result.status}: ${result.error}`,
      );
    }
    return {
      ...result.data,
      toolName: "manageWiki",
      uuid: result.data.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Loading wiki...",
  viewComponent: View,
  previewComponent: Preview,
};

export default wikiPlugin;
