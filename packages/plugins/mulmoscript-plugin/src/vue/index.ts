import "../style.css";
// The editor's own utilities. Tailwind only scans THIS package's source, and a host's
// Tailwind build only scans what its `@source` names — so nothing here generates the
// classes `BeatListEditor`'s markup uses. Measured before the migration: the deck editor
// was rendering without `w-96`, `min-h-0`, `overflow-auto` or `border-r`, and no host
// imported the stylesheet either.
import "@mulmocast/beat-editor/style.css";

import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { MulmoScriptData, SaveMulmoScriptArgs } from "../core/types";
import { pluginCore } from "../core/plugin";
import View from "./View.vue";
import Preview from "./Preview.vue";

export const plugin: ToolPlugin<MulmoScriptData, MulmoScriptData, SaveMulmoScriptArgs> = {
  ...pluginCore,
  viewComponent: View,
  previewComponent: Preview,
};

export type { MulmoScriptData, MulmoScriptExecuteContext, SaveMulmoScriptArgs } from "../core/types";
export type { MulmoScriptDispatchArgs, MulmoScriptDispatchResult, MulmoScriptGenerationEvent, DispatchEnvelope, DispatchFailure } from "../core/contract";
export { GENERATION_EVENT, SCRIPT_CHANGED_EVENT } from "../core/contract";
export { TOOL_NAME, TOOL_DEFINITION } from "../core/definition";
export { MULMOSCRIPT_HOST_ADAPTER_KEY, useHostAdapter, type MulmoScriptHostAdapter } from "./hostAdapter";
export {
  useMulmoScriptTransport,
  type MulmoScriptTransport,
  type TransportResult,
  type GenerationSubscription,
  type ScriptChangedSubscription,
} from "./transport";
export { View, Preview };

export default { plugin };
