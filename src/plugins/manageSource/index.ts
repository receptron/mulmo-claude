import type { ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";

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
    try {
      const res = await fetch("/api/sources/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        return {
          toolName: TOOL_NAME,
          uuid: crypto.randomUUID(),
          error: body?.error ?? res.statusText,
        };
      }
      const result = await res.json();
      return {
        ...result,
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
      };
    } catch (error) {
      return {
        toolName: TOOL_NAME,
        uuid: crypto.randomUUID(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  isEnabled: () => true,
  generatingMessage: "Managing sources…",
  viewComponent: View,
  previewComponent: Preview,
};

export default manageSourcePlugin;
export { TOOL_NAME };
