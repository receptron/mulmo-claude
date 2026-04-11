import type { ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, SYSTEM_PROMPT } from "./definition";
import type { SpreadsheetToolData } from "./definition";
import View from "./View.vue";
import Preview from "./Preview.vue";

const spreadsheetPlugin: ToolPlugin<SpreadsheetToolData> = {
  toolDefinition,

  async execute(_context, args) {
    try {
      const res = await fetch("/api/present-spreadsheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        return {
          toolName: TOOL_NAME,
          uuid: crypto.randomUUID(),
          error: (err as { message?: string }).message ?? res.statusText,
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
  generatingMessage: "Creating spreadsheet...",
  systemPrompt: SYSTEM_PROMPT,
  viewComponent: View,
  previewComponent: Preview,
};

export default spreadsheetPlugin;
export { TOOL_NAME };
