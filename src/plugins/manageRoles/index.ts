import type { ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME, type RolesEndpoints } from "./definition";
import { makePostExecute } from "../execute";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";

export interface CustomRole {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  availablePlugins: string[];
  queries?: string[];
}

export interface ManageRolesData {
  customRoles: CustomRole[];
}

const manageRolesPlugin: ToolPlugin = {
  toolDefinition,
  execute: makePostExecute<RolesEndpoints, ManageRolesData>("roles", "manage", TOOL_NAME),
  isEnabled: () => true,
  generatingMessage: "Managing roles…",
  viewComponent: wrapWithScope("roles", View),
  previewComponent: wrapWithScope("roles", Preview),
};

export default manageRolesPlugin;
export { TOOL_NAME };
