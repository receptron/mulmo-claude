import type { Component } from "vue";
import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import { View, Preview, TOOL_DEFINITION, type PresentChartData } from "@mulmoclaude/chart-plugin/vue";
// The package's component scoped styles are compiled into a standalone
// stylesheet; Vite lib mode does NOT auto-inject it, so the consumer must
// import it — same as @mulmoclaude/{form,markdown}-plugin.
import "@mulmoclaude/chart-plugin/style.css";
import { TOOL_NAME, type ChartEndpoints } from "./definition";
import { makeRouteExecute } from "../execute";
import { wrapWithScope } from "../scope";

// The chart's schema, validation, View, and Preview come from the shared
// @mulmoclaude/chart-plugin package. MulmoClaude keeps the client-side create
// path (POST /api/chart) — the host route injects the generic `files.artifacts`
// capability and calls the package's executeChart. We re-wrap the package's
// components in MulmoClaude's scoped runtime provider (wrapWithScope) so the
// package's useT()/locale resolves to the host.
const chartPlugin: ToolPlugin<PresentChartData> = {
  // gui-chat-protocol type is externalized but yarn-4's dual-@vue can make the
  // package's nominal types distinct; coerce once here.
  toolDefinition: TOOL_DEFINITION as ToolPlugin<PresentChartData>["toolDefinition"],

  execute: makeRouteExecute<ChartEndpoints, PresentChartData>("chart", "create", TOOL_NAME),

  isEnabled: () => true,
  generatingMessage: "Rendering chart…",
  viewComponent: wrapWithScope("chart", View as unknown as Component),
  previewComponent: wrapWithScope("chart", Preview as unknown as Component),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: chartPlugin,
};
