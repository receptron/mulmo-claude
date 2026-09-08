// `renderShapeScript` — rasterise a ShapeScript model to a PNG the AGENT can
// look at, so it can judge its own model instead of guessing from the source.
//
// A pure MCP tool rather than a plugin route: there is no View, nothing is
// pushed to the chat canvas, and the answer is a file path — the same contract
// `generateImage` uses, which is what makes the result readable (the image
// lands under `artifacts/images/` and the agent opens it with Read).
//
// The tool itself — schema, defaults, the four-view sheet, the sentence naming
// the saved file — lives in `@mulmoclaude/shapescript-plugin/render`, because
// MulmoTerminal offers the same tool and those are precisely the parts that
// would drift if each host kept a copy. What is left here is what is actually
// this host's: reading a `.shape` through its file layer, saving into its image
// store, and its logger.

import {
  executeRenderShapeScript,
  RENDER_SHAPE_SCRIPT_DESCRIPTION,
  RENDER_SHAPE_SCRIPT_PROMPT,
  RENDER_SHAPE_SCRIPT_SCHEMA,
  RENDER_SHAPE_SCRIPT_TOOL_NAME,
  RENDER_TOOL_TIMEOUT_MS,
} from "@mulmoclaude/shapescript-plugin/render";
import { isShapeArtifactPath, isPresentableShapePath, toArtifactsRelative, SHAPE_EXTENSIONS } from "@mulmoclaude/shapescript-plugin";
import { readFile } from "fs/promises";
import path from "node:path";
import { saveImage } from "../../utils/files/image-store.js";
import { resolveByPath } from "../../utils/files/by-path.js";
import { workspacePath } from "../../workspace/workspace.js";
import { log } from "../../system/logger/index.js";
import type { McpTool } from "./index.js";

/** Read the source a `path` argument names — an `artifacts/shapes/**` file this
 *  tool saved, or any other `.shape` on disk. Mirrors the plugin's own routing
 *  so `renderShapeScript` and `presentShapeScript` accept exactly the same
 *  paths. */
async function readShapeFile(filePath: string): Promise<string> {
  if (isShapeArtifactPath(filePath)) {
    return readFile(path.join(workspacePath, "artifacts", toArtifactsRelative(filePath)), "utf-8");
  }
  const resolved = isPresentableShapePath(filePath) ? resolveByPath(filePath, SHAPE_EXTENSIONS) : null;
  if (!resolved) throw new Error("`path` must name a .shape file, without `.` / `..` segments");
  return readFile(resolved, "utf-8");
}

export const renderShapeScript: McpTool = {
  definition: {
    name: RENDER_SHAPE_SCRIPT_TOOL_NAME,
    description: RENDER_SHAPE_SCRIPT_DESCRIPTION,
    inputSchema: RENDER_SHAPE_SCRIPT_SCHEMA,
  },
  // Launching a browser and rasterising several views outlasts the bridge's
  // 30 s default for external-API tools; without the headroom a render that was
  // about to succeed is aborted in transit.
  bridgeTimeoutMs: RENDER_TOOL_TIMEOUT_MS,
  prompt: RENDER_SHAPE_SCRIPT_PROMPT,
  handler: async (args: Record<string, unknown>): Promise<string> => {
    log.info("render", "renderShapeScript: start", { args: Object.keys(args).join(",") });
    const { message, rendered } = await executeRenderShapeScript(
      {
        readShape: readShapeFile,
        saveImage,
        onWarning: (warning) => log.warn("render", warning),
      },
      args,
    );
    // `rendered` is the difference between a saved image and a host with no
    // usable browser. Both answer the model with a sentence, so without the flag
    // a degraded service logs exactly like a working one.
    log.info("render", rendered ? "renderShapeScript: ok" : "renderShapeScript: answered without an image", { message });
    return message;
  },
};
