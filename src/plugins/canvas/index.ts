import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, type CanvasEndpoints, type ImageToolData } from "./definition";
import { makeRouteExecute } from "../execute";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";

const canvasPlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  execute: makeRouteExecute<CanvasEndpoints, ImageToolData>("canvas", "dispatch", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Opening drawing canvas...",
  viewComponent: wrapWithScope("canvas", View),
  previewComponent: wrapWithScope("canvas", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: canvasPlugin,
};
