/**
 * Single source of truth for GUI plugin → API endpoint mapping.
 * Used by both agent.ts (to know which plugins are MCP-backed)
 * and mcp-server.ts (to route tool calls to endpoints).
 */

import TodoDef from "../../src/plugins/todo/definition.js";
import ManageCalendarDef from "../../src/plugins/scheduler/calendarDefinition.js";
import ManageAutomationsDef from "../../src/plugins/scheduler/automationsDefinition.js";
import PresentMulmoScriptDef from "../../src/plugins/presentMulmoScript/definition.js";
import ManageRolesDef from "../../src/plugins/manageRoles/definition.js";
import ManageSkillsDef from "../../src/plugins/manageSkills/definition.js";
import ManageSourceDef from "../../src/plugins/manageSource/definition.js";
import WikiDef from "../../src/plugins/wiki/definition.js";
import PresentHtmlDef from "../../src/plugins/presentHtml/definition.js";
import PresentChartDef from "../../src/plugins/chart/definition.js";
import MarkdownDef from "../../src/plugins/markdown/definition.js";
import SpreadsheetDef from "../../src/plugins/spreadsheet/definition.js";
import { TOOL_DEFINITION as MindMapDef } from "@gui-chat-plugin/mindmap";
import GenerateImageDef from "../../src/plugins/generateImage/definition.js";
import { TOOL_DEFINITION as QuizDef } from "@mulmochat-plugin/quiz";
import { TOOL_DEFINITION as FormDef } from "../../src/plugins/presentForm/definition.js";
import CanvasDef from "../../src/plugins/canvas/definition.js";
import EditImageDef from "../../src/plugins/editImage/definition.js";
import { TOOL_DEFINITION as Present3DDef } from "@gui-chat-plugin/present3d";
import { API_ROUTES } from "../../src/config/apiRoutes.js";

/** Maps plugin tool name → REST API endpoint. */
export const TOOL_ENDPOINTS: Record<string, string> = {
  [TodoDef.name]: API_ROUTES.todos.dispatch,
  // Both halves of the former manageScheduler share the same backend
  // endpoint (#824 / PR #758). Server-side dispatch routes per-action
  // via TASK_ACTIONS, so one route happily handles both tool names.
  [ManageCalendarDef.name]: API_ROUTES.scheduler.base,
  [ManageAutomationsDef.name]: API_ROUTES.scheduler.base,
  [MarkdownDef.name]: API_ROUTES.plugins.presentDocument,
  [SpreadsheetDef.name]: API_ROUTES.plugins.presentSpreadsheet,
  [MindMapDef.name]: API_ROUTES.plugins.mindmap,
  [GenerateImageDef.name]: API_ROUTES.image.generate,
  [QuizDef.name]: API_ROUTES.plugins.quiz,
  [FormDef.name]: API_ROUTES.plugins.form,
  [CanvasDef.name]: API_ROUTES.plugins.canvas,
  [PresentHtmlDef.name]: API_ROUTES.html.present,
  [PresentChartDef.name]: API_ROUTES.chart.present,
  [EditImageDef.name]: API_ROUTES.image.edit,
  [Present3DDef.name]: API_ROUTES.plugins.present3d,
  [ManageRolesDef.name]: API_ROUTES.roles.manage,
  [ManageSkillsDef.name]: API_ROUTES.skills.create,
  [ManageSourceDef.name]: API_ROUTES.sources.manage,
  [PresentMulmoScriptDef.name]: API_ROUTES.mulmoScript.save,
  [WikiDef.name]: API_ROUTES.wiki.base,
};

/** All ToolDefinition objects for package and local plugins. */
export const PLUGIN_DEFS = [
  TodoDef,
  ManageCalendarDef,
  ManageAutomationsDef,
  PresentMulmoScriptDef,
  MarkdownDef,
  SpreadsheetDef,
  MindMapDef,
  GenerateImageDef,
  QuizDef,
  FormDef,
  CanvasDef,
  PresentHtmlDef,
  PresentChartDef,
  EditImageDef,
  Present3DDef,
  ManageRolesDef,
  ManageSkillsDef,
  ManageSourceDef,
  WikiDef,
];

/**
 * Set of plugin names that have MCP tool definitions.
 * Includes all GUI plugins + "switchRole" (handled specially).
 */
export const MCP_PLUGIN_NAMES = new Set([...Object.keys(TOOL_ENDPOINTS), "switchRole"]);
