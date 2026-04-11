/**
 * Single source of truth for GUI plugin → API endpoint mapping.
 * Used by both agent.ts (to know which plugins are MCP-backed)
 * and mcp-server.ts (to route tool calls to endpoints).
 */

import TodoDef from "../src/plugins/todo/definition.js";
import SchedulerDef from "../src/plugins/scheduler/definition.js";
import PresentMulmoScriptDef from "../src/plugins/presentMulmoScript/definition.js";
import ManageRolesDef from "../src/plugins/manageRoles/definition.js";
import WikiDef from "../src/plugins/wiki/definition.js";
import PresentHtmlDef from "../src/plugins/presentHtml/definition.js";
import { TOOL_DEFINITION as MarkdownDef } from "@gui-chat-plugin/markdown";
import { TOOL_DEFINITION as SpreadsheetDef } from "@gui-chat-plugin/spreadsheet";
import { TOOL_DEFINITION as MindMapDef } from "@gui-chat-plugin/mindmap";
import { TOOL_DEFINITION as GenerateImageDef } from "@mulmochat-plugin/generate-image";
import { TOOL_DEFINITION as QuizDef } from "@mulmochat-plugin/quiz";
import { TOOL_DEFINITION as FormDef } from "@mulmochat-plugin/form";
import { TOOL_DEFINITION as CanvasDef } from "@gui-chat-plugin/canvas";
import { TOOL_DEFINITION as EditImageDef } from "@gui-chat-plugin/edit-image";
import { TOOL_DEFINITION as Present3DDef } from "@gui-chat-plugin/present3d";
import { TOOL_DEFINITION as MusicDef } from "@gui-chat-plugin/music";

/** Maps plugin tool name → REST API endpoint. */
export const TOOL_ENDPOINTS: Record<string, string> = {
  [TodoDef.name]: "/api/todos",
  [SchedulerDef.name]: "/api/scheduler",
  [MarkdownDef.name]: "/api/present-document",
  [SpreadsheetDef.name]: "/api/present-spreadsheet",
  [MindMapDef.name]: "/api/mindmap",
  [GenerateImageDef.name]: "/api/generate-image",
  [QuizDef.name]: "/api/quiz",
  [FormDef.name]: "/api/form",
  [CanvasDef.name]: "/api/canvas",
  [PresentHtmlDef.name]: "/api/present-html",
  [EditImageDef.name]: "/api/edit-image",
  [Present3DDef.name]: "/api/present3d",
  [MusicDef.name]: "/api/music",
  [ManageRolesDef.name]: "/api/roles/manage",
  [PresentMulmoScriptDef.name]: "/api/mulmo-script",
  [WikiDef.name]: "/api/wiki",
};

/** All ToolDefinition objects for package and local plugins. */
export const PLUGIN_DEFS = [
  TodoDef,
  SchedulerDef,
  PresentMulmoScriptDef,
  MarkdownDef,
  SpreadsheetDef,
  MindMapDef,
  GenerateImageDef,
  QuizDef,
  FormDef,
  CanvasDef,
  PresentHtmlDef,
  EditImageDef,
  Present3DDef,
  MusicDef,
  ManageRolesDef,
  WikiDef,
];

/**
 * Set of plugin names that have MCP tool definitions.
 * Includes all GUI plugins + "switchRole" (handled specially).
 */
export const MCP_PLUGIN_NAMES = new Set([
  ...Object.keys(TOOL_ENDPOINTS),
  "switchRole",
]);
