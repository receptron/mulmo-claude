import type { ToolPlugin } from "../../tools/types";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";

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
    let response: Response;
    try {
      response = await fetch("/api/wiki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Wiki request failed: ${message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Wiki API error ${response.status}: ${text}`);
    }

    const result = await response.json();
    return {
      ...result,
      toolName: "manageWiki",
      uuid: result.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Loading wiki...",
  viewComponent: View,
  previewComponent: Preview,
};

export default wikiPlugin;
