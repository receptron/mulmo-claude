import type { ToolResult } from "gui-chat-protocol";

export interface PresentShapeScriptData {
  script: string;
  /** The `.shape` file this result renders, when it is backed by one. Set for
   *  every result a host with the `files.artifacts` capability produces; absent
   *  for a host that has no file layer, where `script` is the only copy. The
   *  View saves edits back to THIS path — without it, "Apply Changes" only
   *  updates the conversation's copy. */
  filePath?: string | undefined;
}

/** Args the LLM passes when invoking the tool. Two shapes share this type: the
 *  create path (`script`, saved to a fresh `artifacts/shapes/**` path) and the
 *  present-existing path (`path`, rendered in place). Only `title` is
 *  `required` in TOOL_DEFINITION.parameters because JSON Schema can't express
 *  that either-or; the executor enforces the mutual exclusion. */
export interface PresentShapeScriptArgs {
  title: string;
  script?: string;
  path?: string;
}

export type PresentShapeScriptResult = ToolResult<PresentShapeScriptData>;

/** The success shape of `presentShapeScript`.
 *
 *  `data` is REQUIRED here, not optional as on `ToolResult`, because it is the
 *  host's render-eligibility signal: MulmoClaude's MCP bridge only pushes a
 *  tool result into the session — the event the canvas renders the View from —
 *  when the handler set `data`. A result without it is a narrate-only call, so
 *  the LLM would report success while the user saw no 3D view at all. Typing it
 *  as required means dropping it cannot compile.
 */
export type PresentShapeScriptRenderedResult = PresentShapeScriptResult & {
  data: PresentShapeScriptData;
};

export interface ShapeScriptDiagnostic {
  code: "INVALID_ARGUMENT" | "PARSE_ERROR" | "EVALUATION_ERROR" | "LIMIT_EXCEEDED";
  message: string;
  line?: number;
  column?: number;
}

/** Errors carry no renderable data; jsonData is returned to the calling agent. */
export type PresentShapeScriptErrorResult = ToolResult<never, { error: ShapeScriptDiagnostic }> & {
  data?: never;
  error: ShapeScriptDiagnostic;
};

export type PresentShapeScriptExecutionResult = PresentShapeScriptRenderedResult | PresentShapeScriptErrorResult;
