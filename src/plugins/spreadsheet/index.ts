import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, type SpreadsheetEndpoints, type SpreadsheetToolData } from "./definition";
import { makeRouteExecute } from "../execute";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";

const spreadsheetPlugin: ToolPlugin<SpreadsheetToolData> = {
  toolDefinition,

  execute: makeRouteExecute<SpreadsheetEndpoints, SpreadsheetToolData>("spreadsheet", "create", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Creating spreadsheet...",
  viewComponent: wrapWithScope("spreadsheet", View),
  previewComponent: wrapWithScope("spreadsheet", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: spreadsheetPlugin,
};
