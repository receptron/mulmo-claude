// MulmoClaude's thin built-in adapter for the shared markdown plugin
// (task #6 Phase 3). View / Preview / TOOL_DEFINITION come from
// @mulmoclaude/markdown-plugin; the View reaches host backends via
// useRuntime().dispatch -> the built-in "markdown" dispatch handler
// (server/plugins/markdown-builtin.ts). This adapter keeps MulmoClaude's
// existing client-side create path (POST /api/markdown) rather than the
// package's context.app create, so the legacy create route is untouched.
import type { Component } from "vue";
import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import { View, Preview, TOOL_DEFINITION, TOOL_NAME, type MarkdownToolData } from "@mulmoclaude/markdown-plugin/vue";
// The package's component scoped styles (incl. the flex/overflow layout
// that makes the document scrollable) are compiled into a standalone
// stylesheet; Vite lib mode does NOT auto-inject it, so the consumer
// must import it — same as @mulmoclaude/form-plugin (task #6).
import "@mulmoclaude/markdown-plugin/style.css";
import { makeRouteExecute } from "../execute";
import { wrapWithScope } from "../scope";
import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";

/** Resolved `{ method, url }` per markdown route (create / update). */
type DocumentEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

const markdownPlugin: ToolPlugin<MarkdownToolData> = {
  // gui-chat-protocol type is externalized but yarn-4's dual-@vue can
  // make the package's nominal types distinct; coerce once here.
  toolDefinition: TOOL_DEFINITION as ToolPlugin<MarkdownToolData>["toolDefinition"],

  execute: makeRouteExecute<DocumentEndpoints, MarkdownToolData>("markdown", "create", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Creating document...",
  viewComponent: wrapWithScope("markdown", View as unknown as Component),
  previewComponent: wrapWithScope("markdown", Preview as unknown as Component),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: markdownPlugin,
};
