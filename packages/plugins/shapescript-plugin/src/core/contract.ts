// Host-agnostic dispatch envelope for the presentShapeScript View. The Vue
// View is decoupled from any one host's REST surface: it calls
// `useRuntime().dispatch({ kind, … })`, the host routes that to the package's
// `executeShapeScriptDispatch` (see `./dispatch`), and the dispatch reaches
// host storage only through the GENERIC gui-chat-protocol `files.artifacts`
// capability — no presentShapeScript-specific host method.

/** True for a non-null, non-array object. Local rather than imported from
 *  `@mulmoclaude/common`: this package's only other dependency is
 *  `@mulmoclaude/core/artifacts` (browser-safe path rules), and one two-line
 *  predicate does not justify a second. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the current source of an existing ShapeScript artifact — the View
 *  refreshes from disk so an edit made elsewhere (the agent, an editor) is
 *  what gets rendered, not the copy frozen into the tool result. */
export interface LoadShapeArgs {
  kind: "loadShape";
  /** Workspace-relative path under `artifacts/shapes/…`. */
  path: string;
}

/** Overwrite an existing ShapeScript artifact in place (the source editor's
 *  "Apply Changes"). */
export interface SaveShapeArgs {
  kind: "saveShape";
  /** Workspace-relative path under `artifacts/shapes/…`. */
  path: string;
  script: string;
}

/** Discriminated union of every action the View's package router serves. */
export type ShapeScriptDispatchArgs = LoadShapeArgs | SaveShapeArgs;

/** Maps a dispatch `kind` to its result shape. Read back with the readers
 *  below — protocol 2.0.0 makes `dispatch` return `unknown` without one,
 *  because naming the type at the call site never checked anything. */
export interface ShapeScriptDispatchResult {
  loadShape: { script: string };
  saveShape: { path: string };
}

// ── Runtime guards ──────────────────────────────────────────────────
//
// A dispatch payload arrives from the View over the host's HTTP surface, so
// it is untyped data, not a value the compiler has seen. These live beside
// the shapes they check — a guard in one host would leave every other host
// asserting the same shape by hand.

/** True when `value` is a well-formed payload for the package router.
 *
 *  `saveShape` additionally requires `script` to be a string — without that,
 *  `undefined` would reach `files.artifacts.write` and blank the artifact. */
export function isShapeScriptDispatchArgs(value: unknown): value is ShapeScriptDispatchArgs {
  if (!isRecord(value) || typeof value.path !== "string") return false;
  if (value.kind === "loadShape") return true;
  return value.kind === "saveShape" && typeof value.script === "string";
}

// ── Result readers ──────────────────────────────────────────────────
//
// The mirror of the argument guards above: a dispatch RESPONSE is untyped
// data too. They throw, which is the documented idiom for `dispatch` — the
// View's own try/catch reports it.

const expected = (what: string, value: unknown): never => {
  throw new Error(`shapescript plugin: dispatch returned no ${what} (got ${typeof value})`);
};

export function readLoadShapeResult(value: unknown): ShapeScriptDispatchResult["loadShape"] {
  if (isRecord(value) && typeof value.script === "string") return { script: value.script };
  return expected("loadShape result", value);
}

export function readSaveShapeResult(value: unknown): ShapeScriptDispatchResult["saveShape"] {
  if (isRecord(value) && typeof value.path === "string") return { path: value.path };
  return expected("saveShape result", value);
}
