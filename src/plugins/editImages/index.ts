import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, type ImageEndpoints, type ImageToolData } from "./definition";
import { makePostExecute } from "../execute";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";

const editImagesPlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  execute: makePostExecute<ImageEndpoints, ImageToolData>("image", "edit", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Editing images...",
  viewComponent: wrapWithScope("image", View),
  previewComponent: wrapWithScope("image", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: editImagesPlugin,
};
