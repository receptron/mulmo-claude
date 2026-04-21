/**
 * Text Response Plugin Core
 */

import type { ToolPluginCore, ToolContext, ToolResult } from "gui-chat-protocol";
import type { TextResponseData, TextResponseArgs } from "./types";
import { TOOL_DEFINITION, SYSTEM_PROMPT } from "./definition";

export { TOOL_NAME, TOOL_DEFINITION, SYSTEM_PROMPT } from "./definition";

export const executeTextResponse = async (_context: ToolContext, args: TextResponseArgs): Promise<ToolResult<TextResponseData, unknown>> => {
  return {
    data: {
      text: args.text,
      role: args.role,
      transportKind: args.transportKind,
    },
    message: args.text,
  };
};

export const pluginCore: ToolPluginCore<TextResponseData, unknown, TextResponseArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: executeTextResponse,
  generatingMessage: "Processing...",
  // Never advertise this pseudo tool to the LLM; only the client uses it.
  isEnabled: () => false,
  systemPrompt: SYSTEM_PROMPT,
};
