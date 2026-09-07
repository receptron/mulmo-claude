import type { ToolContext, ToolPluginCore } from "gui-chat-protocol";
import type { PresentShapeScriptArgs, PresentShapeScriptData, PresentShapeScriptExecutionResult, ShapeScriptDiagnostic } from "./types";
import { TOOL_NAME, TOOL_DEFINITION } from "./definition";

import { parseShapeScript } from "../shapescript/parser";
import { astToThreeJS, ShapeScriptLimitError } from "../shapescript/toThreeJS";
import { disposeObject3D } from "../shapescript/dispose";
import { ParseError } from "../shapescript/types";

export const presentShapeScript = async (_context: ToolContext, args: PresentShapeScriptArgs): Promise<PresentShapeScriptExecutionResult> => {
  let code: ShapeScriptDiagnostic["code"] = "INVALID_ARGUMENT";
  try {
    if (!args || typeof args.script !== "string" || args.script.trim() === "") {
      throw new Error("ShapeScript code is required but was not provided");
    }
    if (typeof args.title !== "string" || args.title.trim() === "") {
      throw new Error("A nonempty visualization title is required");
    }
    code = "EVALUATION_ERROR";
    // Geometry construction is headless: validate the same evaluator/builders
    // the browser uses, then release the temporary scene before returning.
    const group = astToThreeJS(parseShapeScript(args.script));
    disposeObject3D(group);
    return {
      message: `Created 3D visualization: ${args.title}`,
      title: args.title,
      data: { script: args.script },
      instructions: "Acknowledge that the 3D visualization has been created and is displayed to the user. They can rotate, zoom, and pan the camera.",
    };
  } catch (cause) {
    const error: ShapeScriptDiagnostic = {
      code: cause instanceof ParseError ? "PARSE_ERROR" : cause instanceof ShapeScriptLimitError ? "LIMIT_EXCEEDED" : code,
      message: cause instanceof Error ? cause.message : String(cause),
      ...(cause instanceof ParseError && cause.line !== undefined ? { line: cause.line } : {}),
      ...(cause instanceof ParseError && cause.column !== undefined ? { column: cause.column } : {}),
    };
    return {
      message: `ShapeScript error: ${error.message}`,
      error,
      jsonData: { error },
      instructions: "The visualization was not created. Correct the ShapeScript using the returned diagnostic and call presentShapeScript again.",
    };
  }
};

export const pluginCore: ToolPluginCore<PresentShapeScriptData, unknown, PresentShapeScriptArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: presentShapeScript,
  generatingMessage: "Creating 3D visualization...",
  waitingMessage: "Tell the user that the 3D visualization was created and will be presented shortly.",
  isEnabled: () => true,
};

export { TOOL_NAME, TOOL_DEFINITION };
export const executePresentShapeScript = presentShapeScript;
