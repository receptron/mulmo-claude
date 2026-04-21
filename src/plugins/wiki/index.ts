import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

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
    const result = await apiPost<ToolResult<WikiData>>(API_ROUTES.wiki.base, args);
    if (!result.ok) {
      // Return an error ToolResult instead of throwing so execute()
      // stays symmetric with every other plugin in this repo. Callers
      // can branch on the `error` field uniformly.
      const prefix = result.status === 0 ? "Wiki request failed" : `Wiki API error ${result.status}`;
      return {
        toolName: "manageWiki",
        uuid: crypto.randomUUID(),
        message: `${prefix}: ${result.error}`,
      };
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
