/**
 * Text Response Plugin - Tool Definition
 */

import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "text-response";

export const TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  description: "Render plain text content from the assistant.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Plain text content to display to the user.",
      },
      role: {
        type: "string",
        enum: ["assistant", "system", "user"],
        description: "Speaker role of the message.",
      },
      transportKind: {
        type: "string",
        description:
          "Identifier for the transport or provider that produced the message.",
      },
    },
    required: ["text"],
  },
};

export const SYSTEM_PROMPT = "";
