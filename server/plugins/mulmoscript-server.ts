// MulmoClaude's binding of the shared mulmoScript server ops (phase 3 of
// plans/done/feat-mulmoscript-plugin.md). The mulmocast orchestration, realpath
// containment, dispatch routing, and generation tracking all live in
// @mulmoclaude/mulmoscript-plugin/server; this module supplies the
// host-specific backend — stories location, artifacts FileOps, hardened
// atomic writes, the ffmpeg probe, the logger, and the generation fan-out
// (session `pendingGenerations` channel + plugin pubsub) — and registers
// the built-in "mulmoScript" dispatch handler. Imported for side effect at
// boot (server/index.ts); the REST routes in api/routes/mulmo-script.ts
// consume the same instance.

import path from "path";
import { createMulmoScriptServerOps, createMulmoScriptDispatchHandler, GENERATION_EVENT } from "@mulmoclaude/mulmoscript-plugin/server";
import { WORKSPACE_PATHS } from "../workspace/paths.js";
import { writeFileAtomic } from "../utils/files/atomic.js";
import { depStatus } from "../system/optionalDeps.js";
import { log } from "../system/logger/index.js";
import { publishGeneration } from "../events/session-store/index.js";
import type { IPubSub } from "../events/pub-sub/index.js";
import { makeArtifactsFileOps, pluginChannelName } from "./runtime.js";
import { registerBuiltinDispatch } from "./builtin-dispatch.js";

/** Scope name — matches `wrapWithScope("mulmoScript", …)` in
 *  `src/plugins/presentMulmoScript/index.ts`, which is what the View's
 *  `useRuntime().dispatch` / `pubsub` use as the plugin namespace. */
const MULMOSCRIPT_SCOPE = "mulmoScript";

let pubsubInstance: IPubSub | null = null;

export const mulmoScriptOps = createMulmoScriptServerOps({
  storiesDir: path.resolve(WORKSPACE_PATHS.stories),
  artifacts: makeArtifactsFileOps(),
  writeFileAtomic: async (absolutePath, data) => {
    await writeFileAtomic(absolutePath, typeof data === "string" ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  },
  isFfmpegAvailable: () => depStatus("ffmpeg")?.available,
  // Edge-triggered by the package's tracker: fan each transition out to
  // the per-session pendingGenerations channel (sidebar indicator;
  // no-ops without a session) AND the plugin pubsub channel the
  // extracted View subscribes to for spinners + reload-on-finish.
  onGenerationEvent: (chatSessionId, event) => {
    publishGeneration(chatSessionId, event.kind, event.filePath, event.key, event.done, event.error);
    pubsubInstance?.publish(pluginChannelName(MULMOSCRIPT_SCOPE, GENERATION_EVENT), event);
  },
  log: {
    info: (message, data) => log.info("mulmo-script", message, data),
    warn: (message, data) => log.warn("mulmo-script", message, data),
    error: (message, data) => log.error("mulmo-script", message, data),
  },
});

registerBuiltinDispatch(MULMOSCRIPT_SCOPE, createMulmoScriptDispatchHandler(mulmoScriptOps));

/** Wired at boot (initEventPublishers) — publishes before this are
 *  session-only. */
export function initMulmoScriptGenerationPublisher(instance: IPubSub): void {
  pubsubInstance = instance;
}
