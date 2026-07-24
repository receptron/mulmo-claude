import "../style.css";

import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { MarkdownToolData, MarkdownArgs } from "../plugins/markdown/definition";
import { pluginCore } from "../core/plugin";
import View from "../plugins/markdown/View.vue";
import Preview from "../plugins/markdown/Preview.vue";
import MarpView from "../plugins/markdown/MarpView.vue";
import MarpSplitEditor from "../plugins/markdown/MarpSplitEditor.vue";

export const plugin: ToolPlugin<MarkdownToolData, MarkdownToolData, MarkdownArgs> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
};

export type { MarkdownToolData, MarkdownArgs } from "../plugins/markdown/definition";
export type { MarkdownHostApp, MarkdownDispatchArgs, MarkdownDispatchResult, ExportPdfOptions, MarpThemeEntry } from "../plugins/markdown/contract";

export { TOOL_DEFINITION, executeDocument, pluginCore } from "../core/plugin";
export { isFilePath, TOOL_NAME } from "../plugins/markdown/definition";
export { setFilesRawUrl } from "@mulmoclaude/markdown-utils/image/resolve";

// MarpView / MarpSplitEditor are also consumed standalone by hosts that
// render Marp outside the plugin canvas (e.g. MulmoClaude's File
// Explorer). They call useRuntime(), so the host must mount them inside
// a markdown scope provider.
export { View, Preview, MarpView, MarpSplitEditor };

export default { plugin };
