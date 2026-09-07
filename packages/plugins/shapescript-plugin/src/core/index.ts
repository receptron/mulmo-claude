export type {
  PresentShapeScriptData,
  PresentShapeScriptArgs,
  PresentShapeScriptResult,
  PresentShapeScriptRenderedResult,
  PresentShapeScriptErrorResult,
  PresentShapeScriptExecutionResult,
  ShapeScriptDiagnostic,
} from "./types";
export { TOOL_NAME, TOOL_DEFINITION } from "./definition";
export { pluginCore, presentShapeScript, executePresentShapeScript } from "./plugin";
export type { ShapeScriptExecuteContext } from "./plugin";
export { executeShapeScriptDispatch, locateShape } from "./dispatch";
export type { ShapeScriptDispatchContext } from "./dispatch";
export { isShapeScriptDispatchArgs, readLoadShapeResult, readSaveShapeResult } from "./contract";
export type { LoadShapeArgs, SaveShapeArgs, ShapeScriptDispatchArgs, ShapeScriptDispatchResult } from "./contract";
export { isPresentableShapePath, isShapeArtifactPath, shapeArtifactPath, toArtifactsRelative, SHAPE_EXTENSIONS } from "./paths";
export { samples } from "./samples";

// Re-export ShapeScript utilities
export { parseShapeScript } from "../shapescript/parser";
export { astToThreeJS } from "../shapescript/toThreeJS";
export type { SceneNode } from "../shapescript/types";
