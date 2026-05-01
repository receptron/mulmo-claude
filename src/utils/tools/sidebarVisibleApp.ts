// Vue-coupled wrapper around the pure `isSidebarVisible` predicate.
// Imports the plugin registry (which transitively loads .vue files)
// so it lives in a separate module from the pure predicate — Node
// test files that import callers of `isSidebarVisible` (with their
// own injected `hasPreview` lookup) can do so without dragging the
// registry through `node:test`.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { getPlugin } from "../../tools";
import { isSidebarVisible as isSidebarVisibleRaw } from "./sidebarVisible";

const hasPreview = (toolName: string): boolean => Boolean(getPlugin(toolName)?.previewComponent);

export function isSidebarVisible(result: ToolResultComplete): boolean {
  return isSidebarVisibleRaw(result, hasPreview);
}
