import type { ToolPlugin } from "../../tools/types";
import View from "./View.vue";
import Preview from "./Preview.vue";
import toolDefinition from "./definition";

export interface ChatHistorySearchResult {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  startedAt: string;
  score: number;
  snippet: string;
}

export interface ChatHistorySearchData {
  query: string;
  results: ChatHistorySearchResult[];
}

const searchChatHistoryPlugin: ToolPlugin<ChatHistorySearchData> = {
  toolDefinition,

  async execute(_context, args) {
    let response: Response;
    try {
      response = await fetch("/api/chat-history/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Chat history search request failed: ${message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Chat history search API error ${response.status}: ${text}`,
      );
    }

    const result = await response.json();
    return {
      ...result,
      toolName: "searchChatHistory",
      uuid: result.uuid ?? crypto.randomUUID(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Searching chat history...",
  viewComponent: View,
  previewComponent: Preview,
};

export default searchChatHistoryPlugin;
