import type { ToolPluginCore, ToolResult } from "gui-chat-protocol";
import { mulmoScriptSchema } from "@mulmocast/types";
import { errorMessage } from "@mulmoclaude/common";
import { TOOL_DEFINITION } from "./definition";
import { normalizeStoryPath, storyFilePath } from "./paths";
import { validateUpdateBeatBody, validateUpdateScriptBody } from "./validate";
import type { MulmoScriptData, MulmoScriptExecuteContext, SaveMulmoScriptArgs } from "./types";

/** Failure half of every outcome below. `code` preserves the hosts'
 *  HTTP contract (bad_request → 400, not_found → 404) without the package
 *  knowing anything about HTTP. */
export interface MulmoScriptFailure {
  ok: false;
  code: "bad_request" | "not_found";
  error: string;
}

export type SaveMulmoScriptOutcome = ({ ok: true; message: string } & MulmoScriptData) | MulmoScriptFailure;

export type UpdateMulmoScriptOutcome = { ok: true } | MulmoScriptFailure;

function badRequest(error: string): MulmoScriptFailure {
  return { ok: false, code: "bad_request", error };
}

function notFound(error: string): MulmoScriptFailure {
  return { ok: false, code: "not_found", error };
}

function stringifyScript(script: unknown): string {
  // 2-space indent matches the hosts' writeJsonAtomic convention so a
  // package-written script diffs cleanly against host-written ones.
  return JSON.stringify(script, null, 2);
}

/** Persist a new, schema-validated script under a fresh `stories/…` path. */
async function saveNewScript(context: MulmoScriptExecuteContext, script: unknown, filename: string | undefined, now: Date): Promise<SaveMulmoScriptOutcome> {
  const validation = mulmoScriptSchema.safeParse(script);
  if (!validation.success) {
    return badRequest("script is not a valid MulmoScript");
  }
  const validatedScript = validation.data;
  // slugify drops `/`, `\`, and `..`, so a hostile `filename` like
  // "../../etc/passwd" can never escape the stories dir — defense in
  // depth on top of FileOps' own containment check.
  const slugSource = filename ? filename.replace(/\.json$/i, "") : validatedScript.title || "untitled";
  const filePath = storyFilePath(slugSource, now);
  await context.files.artifacts.write(filePath, stringifyScript(validatedScript));
  return { ok: true, script: validatedScript, filePath, message: `Saved MulmoScript to ${filePath}` };
}

/** Re-open an existing script: containment guard, existence, JSON parse,
 *  schema validation — same acceptance rules as the save path so a script
 *  this package saved can never be one it later refuses to load. */
async function loadExistingScript(context: MulmoScriptExecuteContext, filePath: string): Promise<SaveMulmoScriptOutcome> {
  if (!filePath.toLowerCase().endsWith(".json")) {
    return badRequest("filePath must point to a .json file");
  }
  const storyPath = normalizeStoryPath(filePath);
  if (!storyPath) {
    return badRequest("Invalid filePath");
  }
  if (!(await context.files.artifacts.exists(storyPath))) {
    return notFound(`File not found: ${filePath}`);
  }
  const raw = await context.files.artifacts.read(storyPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return badRequest(`Invalid JSON: ${errorMessage(err)}`);
  }
  const validation = mulmoScriptSchema.safeParse(parsed);
  if (!validation.success) {
    return badRequest("File is not a valid MulmoScript");
  }
  return { ok: true, script: validation.data, filePath: storyPath, message: `Loaded MulmoScript from ${storyPath}` };
}

/**
 * Unified save-or-reopen for the presentMulmoScript tool call. `script`
 * (create new) and `filePath` (existing) are mutually exclusive. Never
 * throws on bad input — validation failures come back as discriminated
 * failures so host routes stay thin adapters. `autoGenerateMovie` is NOT
 * handled here: movie generation needs host backends (mulmocast/ffmpeg),
 * so hosts that support it trigger it from the returned `filePath`.
 */
export async function executeMulmoScriptSave(
  context: MulmoScriptExecuteContext,
  args: SaveMulmoScriptArgs,
  now: Date = new Date(),
): Promise<SaveMulmoScriptOutcome> {
  const { script, filename, filePath } = args ?? {};
  const hasScript = script !== undefined && script !== null;
  const hasFilePath = typeof filePath === "string" && filePath !== "";
  if (hasScript === hasFilePath) {
    return badRequest(
      hasScript ? "Provide either `script` or `filePath`, not both." : "Provide either `script` (new presentation) or `filePath` (existing presentation).",
    );
  }
  return hasFilePath
    ? loadExistingScript(context, filePath as string)
    : saveNewScript(context, script, typeof filename === "string" ? filename : undefined, now);
}

/** Resolve + guard a wire path for the update endpoints. */
async function resolveExistingStory(context: MulmoScriptExecuteContext, filePath: string): Promise<{ storyPath: string } | MulmoScriptFailure> {
  const storyPath = normalizeStoryPath(filePath);
  if (!storyPath) return badRequest("Invalid filePath");
  if (!(await context.files.artifacts.exists(storyPath))) {
    return notFound(`File not found: ${filePath}`);
  }
  return { storyPath };
}

/** Overwrite one beat of an existing script (the View's per-beat source
 *  editor). Validates the body shape + beat schema, bounds-checks the index
 *  against the script on disk, and writes the whole file back. */
export async function executeUpdateBeat(context: MulmoScriptExecuteContext, body: unknown): Promise<UpdateMulmoScriptOutcome> {
  const validation = validateUpdateBeatBody(body);
  if (!validation.ok) return badRequest(validation.error);
  const { filePath, beatIndex, beat } = validation.value;

  const resolved = await resolveExistingStory(context, filePath);
  if ("ok" in resolved) return resolved;

  let script: { beats?: unknown[] };
  try {
    script = JSON.parse(await context.files.artifacts.read(resolved.storyPath));
  } catch (err) {
    return badRequest(`Invalid JSON: ${errorMessage(err)}`);
  }
  if (!Array.isArray(script.beats) || beatIndex >= script.beats.length) {
    return badRequest("Invalid beatIndex");
  }
  script.beats[beatIndex] = beat;
  await context.files.artifacts.write(resolved.storyPath, stringifyScript(script));
  return { ok: true };
}

/** Overwrite the whole script (the View's full-source editor / deck-editor
 *  auto-save). The body's `script` is schema-validated by
 *  `validateUpdateScriptBody` before the write. */
export async function executeUpdateScript(context: MulmoScriptExecuteContext, body: unknown): Promise<UpdateMulmoScriptOutcome> {
  const validation = validateUpdateScriptBody(body);
  if (!validation.ok) return badRequest(validation.error);
  const { filePath, script } = validation.value;

  const resolved = await resolveExistingStory(context, filePath);
  if ("ok" in resolved) return resolved;

  await context.files.artifacts.write(resolved.storyPath, stringifyScript(script));
  return { ok: true };
}

/** ToolResult-shaped wrapper over `executeMulmoScriptSave` for runtime hosts
 *  (e.g. MulmoTerminal's package loader), where the tool call resolves to a
 *  ToolResult rather than an HTTP response. Failures are narrate-only
 *  (message, no data) so the agent can self-correct. */
export async function executeMulmoScript(context: MulmoScriptExecuteContext, args: SaveMulmoScriptArgs): Promise<ToolResult<MulmoScriptData>> {
  const outcome = await executeMulmoScriptSave(context, args);
  if (!outcome.ok) {
    return {
      message: outcome.error,
      instructions: "Acknowledge the error and retry with a valid `script` (new) or an existing `filePath`.",
    };
  }
  // The tool schema advertises `autoGenerateMovie`, but movie generation
  // needs host backends (mulmocast/ffmpeg) this generic execute path
  // doesn't have — MulmoClaude honours the flag in its own save route.
  // Say so in the result rather than silently dropping the option, so the
  // agent doesn't tell the user a movie is on its way.
  const ignoredMovieNote = args.autoGenerateMovie === true ? " (autoGenerateMovie is not supported by this host and was ignored)" : "";
  return {
    message: `${outcome.message}${ignoredMovieNote}`,
    data: { script: outcome.script, filePath: outcome.filePath },
    instructions: "Display the storyboard to the user.",
  };
}

/** Non-Vue plugin core for runtime hosts that register the package directly.
 *  MulmoClaude consumes only TOOL_DEFINITION + the execute functions in its
 *  own routes, so it doesn't use this. */
export const pluginCore: ToolPluginCore<MulmoScriptData, MulmoScriptData, SaveMulmoScriptArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: executeMulmoScript as unknown as ToolPluginCore<MulmoScriptData, MulmoScriptData, SaveMulmoScriptArgs>["execute"],
  generatingMessage: "Generating MulmoScript storyboard…",
  isEnabled: () => true,
};
