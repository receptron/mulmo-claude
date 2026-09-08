// The `renderShapeScript` TOOL: its schema, its defaults, and what it does with
// them — everything about the tool except where the PNG goes and who logs.
//
// It lives in the package for the same reason the renderer does. Two hosts offer
// this tool, and the parts a model actually sees — the argument descriptions, the
// four-view default, the clamps, the sentence naming the saved file — are exactly
// the parts that would drift silently if each host kept its own copy. What stays
// host-side is genuinely host-shaped: reading a `.shape` through that host's file
// capability, and saving an image where that host keeps images.

import { renderShapeScriptSheet, RenderUnavailableError, RENDER_BUDGET_MS } from "./renderer";
import type { ViewAngle } from "./page";

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

/** Milliseconds a host must allow this tool before its own transport gives up.
 *  Covers launch plus render, plus room for the work either side — serialising
 *  the scene and writing the PNG. A transport sized to the render alone aborts a
 *  call that was about to succeed. */
export const RENDER_TOOL_TIMEOUT_MS = RENDER_BUDGET_MS + 30_000;

export const RENDER_SHAPE_SCRIPT_TOOL_NAME = "renderShapeScript";

export const RENDER_SHAPE_SCRIPT_DESCRIPTION =
  "Render a ShapeScript model to a PNG image and save it, so you can LOOK at the model you wrote and check it before showing it to the user. Returns the image path — read that file to see the result. By default it renders four camera angles onto one sheet, because a single view cannot settle what is in front of what. Takes the same source as presentShapeScript: inline `script`, or `path` to a saved .shape file.";

export const RENDER_SHAPE_SCRIPT_PROMPT =
  "Use renderShapeScript to CHECK a 3D model you wrote before presenting it — it saves a PNG and returns the path, which you then read to see what the model actually looks like. Fix what you see and re-render. Rendering needs a local headless browser; if it reports one is missing, say so and continue with presentShapeScript rather than retrying.";

/** The tool's JSON schema, in the shape both a gui-chat-protocol `ToolDefinition`
 *  (`parameters`) and an MCP tool (`inputSchema`) take. */
export const RENDER_SHAPE_SCRIPT_SCHEMA = {
  type: "object" as const,
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
  required: [] as string[],
};

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

/** What a host has to supply: the two things that are actually its own. */
export interface RenderToolDeps {
  /** Read the `.shape` a `path` argument names, through this host's file layer.
   *  Throws — with a message the agent can act on — when the path is not one it
   *  will open. */
  readShape: (path: string) => Promise<string>;
  /** Persist the PNG (base64) and answer with the path the AGENT should read.
   *  Absolute or relative is the host's call: it depends on where its sessions
   *  run, and only the host knows that. */
  saveImage: (base64: string) => Promise<string>;
  /** Optional host logger for a fault that did not fail the render. */
  onWarning?: (message: string) => void;
}

async function resolveScript(deps: RenderToolDeps, args: Record<string, unknown>): Promise<string> {
  const script = typeof args.script === "string" && args.script.trim() !== "" ? args.script : undefined;
  const filePath = typeof args.path === "string" && args.path.trim() !== "" ? args.path : undefined;
  if (script && filePath) throw new Error("Provide either `script` or `path`, not both");
  if (script) return script;
  if (filePath) return deps.readShape(filePath);
  throw new Error("Provide either `script` (inline source) or `path` (an existing .shape file)");
}

/**
 * Run one `renderShapeScript` call and answer with the sentence the agent reads.
 *
 * A missing browser comes back as that sentence rather than a throw: the model
 * can do nothing about it, and the useful response is the install hint plus
 * "carry on without me". Everything else throws, so a host's own error path
 * reports it.
 */
export async function executeRenderShapeScript(deps: RenderToolDeps, args: Record<string, unknown>): Promise<string> {
  const script = await resolveScript(deps, args);
  const views = viewAngles(num(args.azimuth, DEFAULT_AZIMUTH), num(args.elevation, DEFAULT_ELEVATION), args.views === "single");
  try {
    const base64 = await renderShapeScriptSheet({
      script,
      views,
      width: clampTile(args.width, DEFAULT_TILE),
      height: clampTile(args.height, DEFAULT_TILE),
      zoom: Math.max(num(args.zoom, DEFAULT_ZOOM), 0.01),
      projection: args.projection === "orthographic" ? "orthographic" : "perspective",
      ...(deps.onWarning ? { onWarning: deps.onWarning } : {}),
    });
    const imagePath = await deps.saveImage(base64);
    const captions = views.map((angle) => angle.label).join("; ");
    const count = views.length === 1 ? "1 view" : `${views.length} views`;
    return `Saved render to ${imagePath} (${count}: ${captions}). Read that file to see the model.`;
  } catch (err) {
    if (err instanceof RenderUnavailableError) return err.message;
    throw err;
  }
}
