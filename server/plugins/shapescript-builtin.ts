// MulmoClaude's host wiring for the presentShapeScript plugin's dispatch
// channel. The extracted @mulmoclaude/shapescript-plugin View reaches host
// storage through `useRuntime().dispatch({ kind: "loadShape" | "saveShape", … })`;
// this registers the built-in "shapescript" dispatch handler that routes those
// calls to the package's `executeShapeScriptDispatch` against the GENERIC
// `files.artifacts` capability, then publishes a file-change event after a save
// so subscribed View tabs refresh. Imported for side effect at boot
// (server/index.ts) so the dispatch resolves.

import { executeShapeScriptDispatch, isShapeScriptDispatchArgs, SHAPE_EXTENSIONS } from "@mulmoclaude/shapescript-plugin";
import { makeArtifactsFileOps } from "./runtime.js";
import { publishFileChange } from "../events/file-change.js";
import { describeKind, registerBuiltinDispatch } from "./builtin-dispatch.js";
import { makeByPathFileOps } from "../utils/files/by-path.js";

/** Scope name — matches `wrapWithScope("shapescript", …)` in
 *  `src/plugins/presentShapeScript/index.ts`, which is what the View's
 *  `useRuntime().dispatch` uses as the `:pkg` path segment. */
const SHAPESCRIPT_SCOPE = "shapescript";

// `byPath` is what lets presentShapeScript open a source outside
// `artifacts/shapes/` (a workspace file, or an absolute path). Built once:
// it holds no state.
const shapeFiles = { artifacts: makeArtifactsFileOps(), byPath: makeByPathFileOps(SHAPE_EXTENSIONS) };

// `args` is whatever the View put on the wire — untyped data, not a value the
// compiler has vouched for. The package exports a guard for its own shape, so
// the boundary narrows instead of asserting.
registerBuiltinDispatch(SHAPESCRIPT_SCOPE, async (args) => {
  if (!isShapeScriptDispatchArgs(args)) {
    throw new Error(`shapescript plugin: unrecognised dispatch payload (kind=${describeKind(args)})`);
  }
  const result = await executeShapeScriptDispatch({ files: shapeFiles }, args);
  // saveShape changed bytes on disk → nudge subscribed View tabs (load is read-only).
  if (args.kind === "saveShape") {
    void publishFileChange(args.path);
  }
  return result;
});
