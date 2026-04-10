import type { ToolDefinition } from "gui-chat-protocol";

const toolDefinition: ToolDefinition = {
  type: "function",
  name: "searchChatHistory",
  description:
    "Search past chat sessions by keyword or phrase. Use this whenever the user references a previous conversation ('the other day', 'previously', 'remember when…'). Returns up to N matching sessions with title, summary, keywords, and a numeric relevance score. Then choose the most relevant session and either summarize what was discussed or offer to load it. Do not browse chat/ files directly.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text query — keywords, phrases, or topic names. Matched against session titles, summaries, and keywords.",
      },
      limit: {
        type: "number",
        description:
          "Maximum number of results to return (default 10, max 50).",
      },
    },
    required: ["query"],
  },
};

export default toolDefinition;
