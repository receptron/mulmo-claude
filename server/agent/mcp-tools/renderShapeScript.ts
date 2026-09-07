// `renderShapeScript` — rasterise a ShapeScript model to a PNG the AGENT can
// look at, so it can judge its own model instead of guessing from the source.
//
// A pure MCP tool rather than a plugin route: there is no View, nothing is
// pushed to the chat canvas, and the answer is a file path — the same contract
// `generateImage` uses, which is what makes the result readable (the image
// lands under `artifacts/images/` and the agent opens it with Read).

import { isShapeArtifactPath, isPresentableShapePath, toArtifactsRelative } from "@mulmoclaude/shapescript-plugin";
import { readFile } from "fs/promises";
import path from "node:path";
import { saveImage } from "../../utils/files/image-store.js";
import { resolveByPath } from "../../utils/files/by-path.js";
import { workspacePath } from "../../workspace/workspace.js";
import { renderShapeScriptSheet, RenderUnavailableError } from "../../utils/render/shapeScriptRenderer.js";
import type { ViewAngle } from "../../utils/render/shapeScriptPage.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import type { McpTool } from "./index.js";

const DEFAULT_AZIMUTH = 30;
const DEFAULT_ELEVATION = 25;
const DEFAULT_ZOOM = 1;
const DEFAULT_TILE = 480;
// A tile bigger than this buys the model nothing and costs render time; the
// sheet is up to 2x2 of these.
const MAX_TILE = 900;
const MIN_TILE = 160;
// Not a true 90: a hair off vertical keeps a little of the sides visible, which
// is what tells the reader how tall the model is.
const TOP_ELEVATION = 85;

const SHAPE_EXTENSIONS = [".shape"] as const;

function clampTile(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_TILE, Math.max(MIN_TILE, Math.round(value)));
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Round for a caption — an azimuth of `30.000000000000004` helps nobody. */
const deg = (value: number): string => `${Math.round(value)}°`;

/**
 * The angles one call renders.
 *
 * The default is FOUR views, not one, and that is the point of the tool: a
 * single projection is ambiguous about depth and occlusion, and a model asked
 * to judge one confidently gets "which of these is in front" wrong. Three
 * quarters around the model plus a top-down resolves it.
 */
export function viewAngles(azimuth: number, elevation: number, single: boolean): ViewAngle[] {
  const view = (turn: number, rise: number, name: string): ViewAngle => ({
    azimuth: turn,
    elevation: rise,
    label: `${name} — az ${deg(turn)}, el ${deg(rise)}`,
  });
  if (single) return [view(azimuth, elevation, "view")];
  return [
    view(azimuth, elevation, "front-right"),
    view(azimuth + 90, elevation, "back-right"),
    view(azimuth + 180, elevation, "back-left"),
    view(azimuth, TOP_ELEVATION, "top"),
  ];
}

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

async function resolveScript(args: Record<string, unknown>): Promise<string> {
  const script = typeof args.script === "string" && args.script.trim() !== "" ? args.script : undefined;
  const filePath = typeof args.path === "string" && args.path.trim() !== "" ? args.path : undefined;
  if (script && filePath) throw new Error("Provide either `script` or `path`, not both");
  if (script) return script;
  if (filePath) return readShapeFile(filePath);
  throw new Error("Provide either `script` (inline source) or `path` (an existing .shape file)");
}

export const renderShapeScript: McpTool = {
  definition: {
    name: "renderShapeScript",
    description:
      "Render a ShapeScript model to a PNG image and save it, so you can LOOK at the model you wrote and check it before showing it to the user. Returns the image path — read that file to see the result. By default it renders four camera angles onto one sheet, because a single view cannot settle what is in front of what. Takes the same source as presentShapeScript: inline `script`, or `path` to a saved .shape file.",
    inputSchema: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "ShapeScript source to render. Provide either this or `path`, not both.",
        },
        path: {
          type: "string",
          description: "Path to an existing .shape file to render (e.g. one presentShapeScript saved under artifacts/shapes/).",
        },
        azimuth: {
          type: "number",
          description: `Camera rotation around the model in degrees, 0 = looking from +Z. Default ${DEFAULT_AZIMUTH}. In the default four-view sheet this is the FIRST view's angle; the others are offset from it.`,
        },
        elevation: {
          type: "number",
          description: `Camera height in degrees above the horizon, 90 = straight down. Default ${DEFAULT_ELEVATION}. Avoid 0 and 90 for the main view — an axis-aligned shot flattens depth.`,
        },
        zoom: {
          type: "number",
          description: `Multiplier on the automatic framing, which fits the whole model. 1 = fit (default), 2 = twice as close, 0.5 = further out. Prefer this over guessing a camera distance: it means the same thing at any model scale.`,
        },
        views: {
          type: "string",
          enum: ["quad", "single"],
          description:
            "`quad` (default) renders four angles on one sheet — use it to judge shape and layout. `single` renders only `azimuth`/`elevation`, for a close look at one detail.",
        },
        projection: {
          type: "string",
          enum: ["perspective", "orthographic"],
          description: "`perspective` (default) looks natural; `orthographic` keeps parallel edges parallel, which is better for comparing proportions.",
        },
        width: {
          type: "number",
          description: `Pixel width of ONE view. Default ${DEFAULT_TILE}, clamped to ${MIN_TILE}–${MAX_TILE}.`,
        },
        height: {
          type: "number",
          description: `Pixel height of ONE view. Default ${DEFAULT_TILE}, clamped to ${MIN_TILE}–${MAX_TILE}.`,
        },
      },
      required: [],
    },
  },
  prompt:
    "Use renderShapeScript to CHECK a 3D model you wrote before presenting it — it saves a PNG and returns the path, which you then read to see what the model actually looks like. Fix what you see and re-render. Rendering needs a local headless browser; if it reports one is missing, say so and continue with presentShapeScript rather than retrying.",
  handler: async (args: Record<string, unknown>): Promise<string> => {
    const script = await resolveScript(args);
    const azimuth = num(args.azimuth, DEFAULT_AZIMUTH);
    const elevation = num(args.elevation, DEFAULT_ELEVATION);
    const views = viewAngles(azimuth, elevation, args.views === "single");
    log.info("render", "renderShapeScript: start", { views: views.length, bytes: script.length });
    try {
      const base64 = await renderShapeScriptSheet({
        script,
        views,
        width: clampTile(args.width, DEFAULT_TILE),
        height: clampTile(args.height, DEFAULT_TILE),
        zoom: Math.max(num(args.zoom, DEFAULT_ZOOM), 0.01),
        projection: args.projection === "orthographic" ? "orthographic" : "perspective",
      });
      const imagePath = await saveImage(base64);
      log.info("render", "renderShapeScript: ok", { imagePath });
      const captions = views.map((angle) => angle.label).join("; ");
      const count = views.length === 1 ? "1 view" : `${views.length} views`;
      return `Saved render to ${imagePath} (${count}: ${captions}). Read that file to see the model.`;
    } catch (err) {
      if (err instanceof RenderUnavailableError) {
        log.warn("render", "renderShapeScript: unavailable", { error: errorMessage(err) });
        return err.message;
      }
      throw err;
    }
  },
};
