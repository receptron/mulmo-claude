// `./server` entry — the heavy, Node-only ops layer (mulmocast
// orchestration, realpath containment, generation tracking) plus the
// dispatch router. Server-only: imports mulmocast/graphai and Node
// built-ins; never bundle into a browser build. Phase 3 of
// plans/done/feat-mulmoscript-plugin.md.

export type {
  GenerateOpArgs,
  MovieGenerationResult,
  MovieProgressEvent,
  MulmoScriptServerBackend,
  MulmoScriptServerLog,
  OpFailure,
  OpResult,
  PdfGenerationResult,
} from "./types";
export {
  buildContext,
  buildBeatIdIndex,
  createMulmoScriptServerOps,
  PDF_MODE,
  PDF_SIZE,
  type MulmoScriptServerOps,
  type RunStoryOpDeps,
  type RunStoryOpOptions,
  type StoryContext,
} from "./ops";
export { createMulmoScriptDispatchHandler, type MulmoScriptDispatchHandler } from "./dispatch";
export { withMulmoErrorCapture, enableGraphAIErrorCapture, composeMulmoErrorMessage, describeMulmoCause } from "./mulmoErrorCapture";
export { GENERATION_EVENT, type MulmoScriptGenerationEvent } from "../core/contract";
export { executeMulmoScriptSave, executeUpdateBeat, executeUpdateScript, type MulmoScriptFailure } from "../core/plugin";
