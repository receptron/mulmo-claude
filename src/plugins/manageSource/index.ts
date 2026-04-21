import type { ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

// Mirrors server/sources/types.ts#Source. Re-declared here so the
// frontend doesn't have to import a server package.
export interface Source {
  slug: string;
  title: string;
  url: string;
  fetcherKind: "rss" | "github-releases" | "github-issues" | "arxiv";
  fetcherParams: Record<string, string>;
  schedule: "daily" | "weekly" | "manual";
  categories: string[];
  maxItemsPerFetch: number;
  addedAt: string;
  notes?: string;
}

export interface RebuildSummary {
  plannedCount: number;
  itemCount: number;
  duplicateCount: number;
  archiveErrors: string[];
  isoDate: string;
}

export interface ManageSourceData {
  sources: Source[];
  // Optional per-action context. Set on register to highlight the
  // newly-added source; set on rebuild so the View can flash the
  // run summary.
  highlightSlug?: string;
  lastRebuild?: RebuildSummary;
  classifyRationale?: string;
}

const manageSourcePlugin: ToolPlugin<ManageSourceData> = {
  toolDefinition,
  async execute(_context, args) {
    const result = await apiPost<ToolResult<ManageSourceData>>(API_ROUTES.sources.manage, args);
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
  generatingMessage: "Managing sources…",
  viewComponent: View,
  previewComponent: Preview,
};

export default manageSourcePlugin;
export { TOOL_NAME };
