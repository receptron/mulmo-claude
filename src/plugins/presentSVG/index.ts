import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, type SvgEndpoints } from "./definition";
import { makeRouteExecute } from "../execute";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";

export interface PresentSvgData {
  title?: string;
  filePath: string;
}

const presentSvgPlugin: ToolPlugin<PresentSvgData> = {
  toolDefinition,

  execute: makeRouteExecute<SvgEndpoints, PresentSvgData>("svg", "create", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Presenting SVG…",
  viewComponent: wrapWithScope("svg", View),
  previewComponent: wrapWithScope("svg", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: presentSvgPlugin,
};
