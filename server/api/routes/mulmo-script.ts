import { Router, Request, Response } from "express";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { stripDataUri } from "../../utils/files/image-store.js";
import { writeJsonAtomic } from "../../utils/files/json.js";
import {
  getFileObject,
  initializeContextFromFiles,
  generateBeatImage,
  getBeatPngImagePath,
  generateBeatAudio,
  getBeatAudioPathOrUrl,
  generateReferenceImage,
  getReferenceImagePath,
  images,
  audio,
  movie,
  movieFilePath,
  setGraphAILogger,
  addSessionProgressCallback,
  removeSessionProgressCallback,
  type MulmoScript,
} from "mulmocast";
import { mulmoScriptSchema, type MulmoBeat, type MulmoImagePromptMedia } from "@mulmocast/types";
import { slugify } from "../../utils/slug.js";
import { resolveWithinRoot } from "../../utils/files/safe.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, notFound, serverError } from "../../utils/httpError.js";
import { getOptionalStringQuery, getSessionQuery } from "../../utils/request.js";
import { log } from "../../system/logger/index.js";
import { validateUpdateBeatBody, validateUpdateScriptBody } from "./mulmoScriptValidate.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { publishGeneration } from "../../events/session-store/index.js";
import { GENERATION_KINDS } from "../../../src/types/events.js";

const router = Router();
const storiesDir = path.resolve(WORKSPACE_PATHS.stories);

// The downloadMovie handler expects "stories/<rel>" (historical
// convention, independent of the on-disk location). After #284 the
// physical directory moved under artifacts/, so we can't return
// path.relative(workspacePath, ...) any more — that now begins with
// "artifacts/stories/". Re-rooting the path at storiesDir keeps the
// wire format stable.
function toStoryRef(absolutePath: string): string {
  const rel = path.relative(storiesDir, absolutePath).split(path.sep).join("/");
  return rel ? `stories/${rel}` : "stories";
}

// Lazily realpath the stories dir on first use. We can't realpath at
// module load because the directory may not exist yet (it's created
// on demand by /mulmo-script POST). The cache is invalidated never —
// once the dir exists, its realpath is stable.
let storiesRealCache: string | null = null;
function ensureStoriesReal(): string | null {
  if (storiesRealCache) return storiesRealCache;
  try {
    mkdirSync(storiesDir, { recursive: true });
    storiesRealCache = realpathSync(storiesDir);
    return storiesRealCache;
  } catch {
    return null;
  }
}

interface SaveMulmoScriptBody {
  script?: MulmoScript;
  filename?: string;
  filePath?: string;
  autoGenerateMovie?: boolean;
}

interface RenderBeatBody {
  filePath: string;
  beatIndex: number;
  force?: boolean;
  chatSessionId?: string;
}

interface UploadBeatImageBody {
  filePath: string;
  beatIndex: number;
  imageData: string; // base64 data URI
}

type ErrorResponse = { error: string };

type BeatImageResponse = { image: string | null } | ErrorResponse;
type BeatAudioResponse = { audio: string | null } | ErrorResponse;
type MovieStatusResponse = { moviePath: string | null } | ErrorResponse;
type GenerateBeatAudioResponse = { audio: string } | ErrorResponse;

interface BeatQuery {
  filePath?: string;
  beatIndex?: string;
}

interface FilePathQuery {
  filePath?: string;
}

interface ScriptOutcome {
  script: MulmoScript;
  /** Workspace-relative wire form, e.g. "stories/foo.json". */
  wireFilePath: string;
  /** Realpath, used by movie generation and the dedup set. */
  absoluteFilePath: string;
  message: string;
}

// Unified entry point — save a fresh `script` OR re-display an existing
// one referenced by `filePath`. Folding both modes into one route lets
// the agent (MCP) and the GUI dispatcher hit the same endpoint without
// either side needing to know which mode the user picked. The MCP layer
// in `server/agent/plugin-names.ts` routes the tool name straight here,
// so any per-mode logic on the client would be invisible to it.
router.post(API_ROUTES.mulmoScript.save, async (req: Request<object, object, SaveMulmoScriptBody>, res: Response) => {
  const { script, filename, filePath, autoGenerateMovie } = req.body ?? {};

  const hasScript = script !== undefined && script !== null;
  const hasFilePath = typeof filePath === "string" && filePath !== "";
  if (hasScript === hasFilePath) {
    badRequest(
      res,
      hasScript ? "Provide either `script` or `filePath`, not both." : "Provide either `script` (new presentation) or `filePath` (existing presentation).",
    );
    return;
  }

  const outcome = hasFilePath ? await loadScriptFromDisk(filePath, res) : await saveScriptToDisk(script as MulmoScript, filename, res);
  if (!outcome) return; // helper already wrote a 4xx/5xx response

  if (autoGenerateMovie === true) {
    triggerAutoBackgroundMovie(outcome.absoluteFilePath, outcome.wireFilePath, getSessionQuery(req) || undefined);
  }

  res.json({
    data: { script: outcome.script, filePath: outcome.wireFilePath },
    message: outcome.message,
    instructions: "Display the storyboard to the user.",
  });
});

async function saveScriptToDisk(script: MulmoScript, filename: string | undefined, res: Response): Promise<ScriptOutcome | null> {
  // Validate against the same schema the reopen path uses so /save and
  // /load agree on what counts as a valid MulmoScript — otherwise
  // /save could persist a script that /load would later refuse, and
  // autoGenerateMovie could kick off against malformed input.
  const validation = mulmoScriptSchema.safeParse(script);
  if (!validation.success) {
    badRequest(res, "script is not a valid MulmoScript");
    return null;
  }
  const validatedScript = validation.data;

  mkdirSync(storiesDir, { recursive: true });

  const title = validatedScript.title || "untitled";
  // slugify drops `/`, `\`, and `..`, so a hostile `filename` like
  // "../../etc/passwd" can never escape storiesDir via the path.join
  // below — defense in depth on top of the wire-side validation.
  const slug = filename ? slugify(filename.replace(/\.json$/i, "")) : slugify(title);
  const fname = `${slug}-${Date.now()}.json`;
  const writePath = path.join(storiesDir, fname);

  await writeJsonAtomic(writePath, validatedScript);

  // Realpath-resolve the freshly written file so `inFlightMovies`
  // entries created from this code path collide with ones produced by
  // `resolveStoryPath` (used by reopen / SSE generateMovie / movie-
  // status). Without this, a symlinked storiesDir would let two movie
  // generations for the same physical file run concurrently because
  // their dedup keys differ (path.join vs realpath).
  let absoluteFilePath: string;
  try {
    absoluteFilePath = realpathSync(writePath);
  } catch {
    absoluteFilePath = writePath;
  }

  return {
    script: validatedScript,
    wireFilePath: `stories/${fname}`,
    absoluteFilePath,
    message: `Saved MulmoScript to stories/${fname}`,
  };
}

async function loadScriptFromDisk(filePath: string, res: Response): Promise<ScriptOutcome | null> {
  if (!filePath.toLowerCase().endsWith(".json")) {
    badRequest(res, "filePath must point to a .json file");
    return null;
  }
  const absoluteFilePath = resolveStoryPath(filePath, res);
  if (!absoluteFilePath) return null; // resolveStoryPath already responded

  let raw: string;
  try {
    raw = readFileSync(absoluteFilePath, "utf-8");
  } catch (err) {
    serverError(res, errorMessage(err));
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    badRequest(res, `Invalid JSON: ${errorMessage(err)}`);
    return null;
  }

  const validation = mulmoScriptSchema.safeParse(parsed);
  if (!validation.success) {
    badRequest(res, "File is not a valid MulmoScript");
    return null;
  }

  // Canonicalize via the realpath-resolved absoluteFilePath so wire
  // forms like "bar.json" or "stories/foo/../bar.json" all collapse
  // to the same "stories/<rel>" key — pendingGenerations and movie-
  // status lookups depend on that stability.
  const wireFilePath = toStoryRef(absoluteFilePath);

  return {
    script: validation.data,
    wireFilePath,
    absoluteFilePath,
    message: `Loaded MulmoScript from ${wireFilePath}`,
  };
}

// Module-level dedup so a foreground SSE call and a fire-and-forget
// background call can't race on the same script. Keyed by the realpath
// (absoluteFilePath) so two different wire spellings of the same file
// still collide. The set is intentionally process-local — a multi-
// process deployment would need an external lock; that's out of scope.
const inFlightMovies = new Set<string>();

function triggerAutoBackgroundMovie(absoluteFilePath: string, wireFilePath: string, chatSessionId: string | undefined): void {
  if (inFlightMovies.has(absoluteFilePath)) return;
  inFlightMovies.add(absoluteFilePath);
  void runBackgroundMovieGeneration(absoluteFilePath, wireFilePath, chatSessionId);
}

router.post(API_ROUTES.mulmoScript.updateBeat, async (req: Request<object, object, unknown>, res: Response) => {
  const validation = validateUpdateBeatBody(req.body);
  if (!validation.ok) {
    badRequest(res, validation.error);
    return;
  }
  const { filePath, beatIndex, beat } = validation.value;

  const absoluteFilePath = resolveStoryPath(filePath, res);
  if (!absoluteFilePath) return;

  const script: MulmoScript = JSON.parse(readFileSync(absoluteFilePath, "utf-8"));

  if (!Array.isArray(script.beats) || beatIndex >= script.beats.length) {
    badRequest(res, "Invalid beatIndex");
    return;
  }

  script.beats[beatIndex] = beat as MulmoBeat;
  await writeJsonAtomic(absoluteFilePath, script);

  res.json({ ok: true });
});

router.post(API_ROUTES.mulmoScript.updateScript, async (req: Request<object, object, unknown>, res: Response) => {
  const validation = validateUpdateScriptBody(req.body);
  if (!validation.ok) {
    badRequest(res, validation.error);
    return;
  }
  const { filePath, script: updatedScript } = validation.value;

  const absoluteFilePath = resolveStoryPath(filePath, res);
  if (!absoluteFilePath) return;

  await writeJsonAtomic(absoluteFilePath, updatedScript);
  res.json({ ok: true });
});

router.get(API_ROUTES.mulmoScript.beatImage, async (req: Request<object, BeatImageResponse, object, BeatQuery>, res: Response<BeatImageResponse>) => {
  const { filePath, beatIndex: beatIndexStr } = req.query;
  const beatIndex = beatIndexStr !== undefined ? parseInt(beatIndexStr, 10) : undefined;

  if (!filePath || beatIndex === undefined || isNaN(beatIndex)) {
    badRequest(res, "filePath and beatIndex are required");
    return;
  }

  await withStoryContext(res, filePath, {}, async ({ context }) => {
    const { imagePath } = getBeatPngImagePath(context, beatIndex);
    if (!existsSync(imagePath)) {
      res.json({ image: null });
      return;
    }
    res.json({ image: fileToDataUri(imagePath, "image/png") });
  });
});

router.get(API_ROUTES.mulmoScript.movieStatus, async (req: Request<object, MovieStatusResponse, object, FilePathQuery>, res: Response<MovieStatusResponse>) => {
  const { filePath } = req.query;

  if (!filePath) {
    badRequest(res, "filePath is required");
    return;
  }

  const absoluteFilePath = resolveStoryPath(filePath, res);
  if (!absoluteFilePath) return;

  try {
    const context = await buildContext(absoluteFilePath);
    if (!context) {
      res.json({ moviePath: null });
      return;
    }

    const outputPath = movieFilePath(context);
    if (!existsSync(outputPath)) {
      res.json({ moviePath: null });
      return;
    }

    const movieMtime = statSync(outputPath).mtimeMs;
    const sourceMtime = statSync(absoluteFilePath).mtimeMs;
    if (movieMtime < sourceMtime) {
      res.json({ moviePath: null });
      return;
    }

    res.json({ moviePath: toStoryRef(outputPath) });
  } catch (err) {
    serverError(res, errorMessage(err));
  }
});

function fileToDataUri(filePath: string, mimeType: string): string {
  const data = readFileSync(filePath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

// Helper: resolve and validate a stories filePath, returns absoluteFilePath or null
//
// Uses the realpath-based resolveWithinRoot helper to defeat
// symlink-based escapes. The previous implementation used a plain
// `path.resolve` + `startsWith` check, which a malicious symlink
// under stories/ could bypass.
//
// Callers pass workspace-relative paths like "stories/foo.json" or
// "stories/__movies__/bar.mp4". We strip the leading "stories/"
// segment and resolve the remainder against the realpath of the
// stories directory itself — this works whether stories/ is a
// regular directory or a legitimate symlink to another location
// (e.g. workspace/stories → /ext/stories on a different disk).
function resolveStoryPath(filePath: string, res: Response): string | null {
  const storiesReal = ensureStoriesReal();
  if (!storiesReal) {
    serverError(res, "stories directory not available");
    return null;
  }
  // Reject absolute paths and parent traversal at the syntactic
  // level — defense in depth on top of the realpath check below.
  if (path.isAbsolute(filePath)) {
    badRequest(res, "Invalid filePath");
    return null;
  }
  // Strip the optional "stories/" prefix so the remainder is a path
  // relative to storiesReal. Accepts both "stories/foo.json" (the
  // canonical caller convention) and bare "foo.json".
  const STORIES_PREFIX = "stories" + path.sep;
  const relFromStories =
    filePath === "stories" ? "" : filePath.startsWith(STORIES_PREFIX) || filePath.startsWith("stories/") ? filePath.slice("stories/".length) : filePath;
  // resolveWithinRoot enforces both the realpath boundary AND
  // existence; ENOENT and traversal both produce null. Distinguish
  // them via a follow-up existsSync so 404 vs 400 stays accurate.
  const resolved = resolveWithinRoot(storiesReal, relFromStories);
  if (!resolved) {
    const candidate = path.resolve(storiesReal, relFromStories);
    if (!existsSync(candidate)) {
      notFound(res, `File not found: ${filePath}`);
    } else {
      badRequest(res, "Invalid filePath");
    }
    return null;
  }
  return resolved;
}

// Helper: build mulmo context for a story file
async function buildContext(absoluteFilePath: string, force = false) {
  setGraphAILogger(false);
  const files = getFileObject({
    file: absoluteFilePath,
    basedir: path.dirname(absoluteFilePath),
    grouped: true,
  });
  return initializeContextFromFiles(files, true, force);
}

// Awaited context type used by every helper that calls buildContext.
type StoryContext = NonNullable<Awaited<ReturnType<typeof buildContext>>>;

interface WithStoryContextDeps {
  resolveStoryPath?: (filePath: string, res: Response) => string | null;
  buildContext?: (absoluteFilePath: string, force?: boolean) => Promise<StoryContext | undefined>;
}

// Shared scaffolding for mulmo-script handlers. Each handler resolves
// the workspace-relative filePath, builds the mulmo context, and
// catches unexpected errors with a 500 + errorMessage. Extracted so
// every handler can focus on its own business logic.
//
// Accepts a `deps` param so unit tests can inject fakes without the
// full mulmocast stack.
export interface WithStoryContextOptions {
  force?: boolean;
  /**
   * Handler-specific tag included in the helper's failure log so
   * dashboards can distinguish which route is failing (e.g.
   * `"generate-beat-audio"`). Falls back to a generic
   * `"handler failed"` entry when omitted.
   */
  operation?: string;
  /**
   * Soft-fail override for `buildContext` returning undefined. Some
   * endpoints (e.g. `GET /beat-audio`) historically returned a
   * 200 `{ audio: null }` in that case so the frontend can silently
   * retry. If provided, this callback writes the fallback response
   * instead of the default 500 `{ error: "Failed to initialize
   * mulmo context" }`.
   */
  onContextMissing?: (res: Response) => void;
}

export async function withStoryContext(
  res: Response,
  filePath: string,
  options: WithStoryContextOptions,
  handler: (ctx: { absoluteFilePath: string; context: StoryContext }) => Promise<void>,
  deps: WithStoryContextDeps = {},
): Promise<void> {
  const resolver = deps.resolveStoryPath ?? resolveStoryPath;
  const build = deps.buildContext ?? buildContext;
  const absoluteFilePath = resolver(filePath, res);
  if (!absoluteFilePath) return;
  try {
    const context = await build(absoluteFilePath, options.force ?? false);
    if (!context) {
      if (options.onContextMissing) {
        options.onContextMissing(res);
      } else {
        serverError(res, "Failed to initialize mulmo context");
      }
      return;
    }
    await handler({ absoluteFilePath, context });
  } catch (err) {
    // Log every handler failure at warn so operators get a breadcrumb
    // even when the migrated handler doesn't wrap its own try/catch.
    // Consistent with the chat-index / wiki-backlinks / journal
    // fire-and-forget error pattern.
    log.warn("mulmo-script", "handler failed", {
      ...(options.operation ? { operation: options.operation } : {}),
      filePath,
      error: errorMessage(err),
    });
    // Double-write guard: if the handler has already started streaming
    // or sent a partial response, appending a 500 body here would
    // trigger Express's "Cannot set headers after they are sent"
    // warning and corrupt the on-wire response.
    if (!res.headersSent) {
      serverError(res, errorMessage(err));
    }
  }
}

router.get(API_ROUTES.mulmoScript.beatAudio, async (req: Request<object, BeatAudioResponse, object, BeatQuery>, res: Response<BeatAudioResponse>) => {
  const { filePath, beatIndex: beatIndexStr } = req.query;
  const beatIndex = beatIndexStr !== undefined ? parseInt(beatIndexStr, 10) : undefined;

  if (!filePath || beatIndex === undefined || isNaN(beatIndex)) {
    badRequest(res, "filePath and beatIndex are required");
    return;
  }

  // GET /beat-audio is a probe — the frontend polls it expecting a
  // 200 with `{ audio: null }` when nothing has been generated yet.
  // Override the helper's default 500-on-context-missing so the
  // soft-fail contract is preserved.
  await withStoryContext(
    res,
    filePath,
    {
      operation: "beat-audio",
      onContextMissing: (response) => response.json({ audio: null }),
    },
    async ({ context }) => {
      const beat = context.studio.script.beats[beatIndex];
      const audioPath = getBeatAudioPathOrUrl(beat.text ?? "", context, beat, context.lang);
      if (!audioPath || !existsSync(audioPath)) {
        res.json({ audio: null });
        return;
      }
      res.json({ audio: fileToDataUri(audioPath, "audio/mpeg") });
    },
  );
});

router.post(
  API_ROUTES.mulmoScript.generateBeatAudio,
  async (
    req: Request<
      object,
      object,
      {
        filePath: string;
        beatIndex: number;
        force?: boolean;
        chatSessionId?: string;
      }
    >,
    res: Response<GenerateBeatAudioResponse>,
  ) => {
    const { filePath, beatIndex, force, chatSessionId } = req.body;

    if (!filePath || beatIndex === undefined) {
      badRequest(res, "filePath and beatIndex are required");
      return;
    }

    const key = String(beatIndex);
    publishGeneration(chatSessionId, GENERATION_KINDS.beatAudio, filePath, key, false);
    let genError: string | undefined;
    try {
      await withStoryContext(res, filePath, { force, operation: "generate-beat-audio" }, async ({ context }) => {
        try {
          await generateBeatAudio(beatIndex, context, {
            settings: process.env as Record<string, string>,
          } as Parameters<typeof generateBeatAudio>[2]);

          const beat = context.studio.script.beats[beatIndex];
          const audioPath = context.studio.beats[beatIndex]?.audioFile ?? getBeatAudioPathOrUrl(beat.text ?? "", context, beat, context.lang);

          if (!audioPath || !existsSync(audioPath)) {
            // Logic-flow failure (not an exception) — emit a targeted
            // log. Don't write raw `beat.text` into persistent logs —
            // it's free-form user content and can contain sensitive
            // data.
            log.error("generate-beat-audio", "audio was not generated", {
              beatIndex,
              audioPath,
              exists: audioPath ? existsSync(audioPath) : false,
              beatTextLength: typeof beat?.text === "string" ? beat.text.length : 0,
              audioFilePresent: Boolean(context.studio.beats[beatIndex]?.audioFile),
            });
            genError = "Audio was not generated";
            serverError(res, genError);
            return;
          }

          res.json({ audio: fileToDataUri(audioPath, "audio/mpeg") });
        } catch (err) {
          genError = errorMessage(err);
          throw err;
        }
      });
    } finally {
      publishGeneration(chatSessionId, GENERATION_KINDS.beatAudio, filePath, key, true, genError);
    }
  },
);

router.post(API_ROUTES.mulmoScript.renderBeat, async (req: Request<object, object, RenderBeatBody>, res: Response) => {
  const { filePath, beatIndex, force, chatSessionId } = req.body;

  if (!filePath || beatIndex === undefined) {
    badRequest(res, "filePath and beatIndex are required");
    return;
  }

  const key = String(beatIndex);
  publishGeneration(chatSessionId, GENERATION_KINDS.beatImage, filePath, key, false);
  // withStoryContext swallows errors and responds with 500, so we
  // track failure via a local flag / message rather than try/catch
  // around the outer call.
  let genError: string | undefined;
  try {
    await withStoryContext(res, filePath, { force }, async ({ context }) => {
      try {
        await generateBeatImage({
          index: beatIndex,
          context,
          args: force ? { forceImage: true } : undefined,
        });

        const { imagePath } = getBeatPngImagePath(context, beatIndex);
        if (!existsSync(imagePath)) {
          genError = "Image was not generated";
          serverError(res, genError);
          return;
        }
        res.json({ image: fileToDataUri(imagePath, "image/png") });
      } catch (err) {
        genError = errorMessage(err);
        throw err;
      }
    });
  } finally {
    publishGeneration(chatSessionId, GENERATION_KINDS.beatImage, filePath, key, true, genError);
  }
});

type MovieGenerationResult = { ok: true; outputPath: string } | { ok: false; error: string };

interface MovieProgressEvent {
  kind: "image" | "audio";
  beatIndex: number;
}

// Shared core for both the SSE-streaming `generateMovie` route and the
// fire-and-forget background path triggered by `autoGenerateMovie`.
// Builds the mulmo context, runs images→audio→movie, and reports
// per-beat progress through the supplied callback. Throws on
// unexpected pipeline errors; returns a structured failure when the
// pipeline runs to completion but the output file is missing.
async function runMovieGeneration(absoluteFilePath: string, onProgressEvent: (event: MovieProgressEvent) => void): Promise<MovieGenerationResult> {
  const context = await buildContext(absoluteFilePath);
  if (!context) return { ok: false, error: "Failed to initialize mulmo context" };

  const idToIndex = new Map<string, number>();
  (context.studio.script.beats as MulmoBeat[]).forEach((beat, index) => {
    const key = beat.id ?? `__index__${index}`;
    idToIndex.set(key, index);
  });

  // Known limitation: addSessionProgressCallback is global, so when two
  // movie generations for *different* scripts run concurrently, both
  // closures are invoked for every beat event and rely on idToIndex to
  // filter out the other run's events. That filter is reliable only
  // when each beat carries an explicit `id`. Beats without one fall
  // back to "__index__${index}", and identical fallback ids across
  // scripts collide → progress meant for script A surfaces on script B.
  // Fixing this properly needs mulmocast to attach a per-run identifier
  // to its progress events (or a global serialization gate); tracked
  // separately, out of scope for this PR.
  const onProgress = (event: { kind: string; sessionType: string; id?: string; inSession: boolean }) => {
    if (event.kind !== "beat" || event.inSession || event.id === undefined) return;
    const beatIndex = idToIndex.get(event.id);
    if (beatIndex === undefined) return;
    if (event.sessionType !== "image" && event.sessionType !== "audio") return;
    onProgressEvent({ kind: event.sessionType, beatIndex });
  };

  addSessionProgressCallback(onProgress);
  try {
    // Order matters: audio() must run before images(). For html_tailwind
    // beats with `animation: true`, mulmocast only emits the per-beat
    // `_animated.mp4` when the beat's duration is already known (see
    // processHtmlTailwindAnimated in mulmocast). Durations are populated
    // by audio(), so running images() first leaves the .mp4 files
    // missing and movie() then fails in validateBeatSource.
    const audioContext = await audio(context);
    const imagesContext = await images(audioContext);
    await movie(imagesContext);

    const outputPath = movieFilePath(imagesContext);
    if (!existsSync(outputPath)) return { ok: false, error: "Movie was not generated" };
    return { ok: true, outputPath };
  } finally {
    removeSessionProgressCallback(onProgress);
  }
}

router.post(API_ROUTES.mulmoScript.generateMovie, async (req: Request<object, object, { filePath: string; chatSessionId?: string }>, res: Response) => {
  const { filePath, chatSessionId } = req.body;

  if (!filePath) {
    badRequest(res, "filePath is required");
    return;
  }

  const absoluteFilePath = resolveStoryPath(filePath, res);
  if (!absoluteFilePath) return;

  if (inFlightMovies.has(absoluteFilePath)) {
    badRequest(res, "Movie generation is already in progress for this script");
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  inFlightMovies.add(absoluteFilePath);
  publishGeneration(chatSessionId, GENERATION_KINDS.movie, filePath, "", false);
  let genError: string | undefined;
  try {
    const result = await runMovieGeneration(absoluteFilePath, (event) => {
      send({ type: `beat_${event.kind}_done`, beatIndex: event.beatIndex });
    });
    if (!result.ok) {
      genError = result.error;
      send({ type: "error", message: result.error });
      return;
    }
    send({ type: "done", moviePath: toStoryRef(result.outputPath) });
  } catch (err) {
    genError = errorMessage(err);
    send({ type: "error", message: genError });
  } finally {
    inFlightMovies.delete(absoluteFilePath);
    publishGeneration(chatSessionId, GENERATION_KINDS.movie, filePath, "", true, genError);
    res.end();
  }
});

// Detached movie generation. Reports progress through the same session
// pendingGenerations channel that the View already watches — so a user
// opening the canvas mid-generation sees spinners, and a user opening
// it after completion sees the finished movie loaded from disk by the
// View's normal mount-time path. Errors are persisted to a
// `<filename>.error.txt` sidecar next to the script (no synchronous
// client to alert); any stale sidecar from a previous run is cleared on
// each new attempt. Triggered server-side from the unified save route
// when the caller passes `autoGenerateMovie: true`.
async function runBackgroundMovieGeneration(absoluteFilePath: string, wireFilePath: string, chatSessionId: string | undefined): Promise<void> {
  const errorSidecarPath = `${absoluteFilePath}.error.txt`;
  // Clear stale error from a previous failed run before starting; if it
  // doesn't exist that's fine. Catch any unexpected fs errors silently —
  // the worst case is the user sees an out-of-date error file later.
  try {
    unlinkSync(errorSidecarPath);
  } catch {
    // intentional: ENOENT is the common case, others non-fatal
  }

  publishGeneration(chatSessionId, GENERATION_KINDS.movie, wireFilePath, "", false);
  let genError: string | undefined;
  try {
    const result = await runMovieGeneration(absoluteFilePath, (event) => {
      // Mirror per-beat completions through the session channel so the
      // View's pendingGenerations watcher reloads the asset off disk.
      // We fire start+finish in two ticks — `setImmediate` lets the SSE
      // writer flush the start event before the finish removes the
      // entry, otherwise Vue's batched reactivity could see a net "no
      // change" and skip the reload.
      const eventKind = event.kind === "image" ? GENERATION_KINDS.beatImage : GENERATION_KINDS.beatAudio;
      const key = String(event.beatIndex);
      publishGeneration(chatSessionId, eventKind, wireFilePath, key, false);
      setImmediate(() => publishGeneration(chatSessionId, eventKind, wireFilePath, key, true));
    });

    if (!result.ok) {
      genError = result.error;
      writeErrorSidecar(errorSidecarPath, result.error);
      log.warn("mulmo-script", "background movie generation failed", { filePath: wireFilePath, error: result.error });
      return;
    }
    log.info("mulmo-script", "background movie generation done", {
      filePath: wireFilePath,
      outputPath: result.outputPath,
    });
  } catch (err) {
    genError = errorMessage(err);
    writeErrorSidecar(errorSidecarPath, genError);
    log.error("mulmo-script", "background movie generation crashed", { filePath: wireFilePath, error: genError });
  } finally {
    inFlightMovies.delete(absoluteFilePath);
    publishGeneration(chatSessionId, GENERATION_KINDS.movie, wireFilePath, "", true, genError);
  }
}

function writeErrorSidecar(errorSidecarPath: string, message: string): void {
  try {
    writeFileSync(errorSidecarPath, message);
  } catch (writeErr) {
    log.error("mulmo-script", "failed to write error sidecar", {
      errorSidecarPath,
      error: errorMessage(writeErr),
    });
  }
}

interface CharacterImageQuery {
  filePath?: string;
  key?: string;
}

interface RenderCharacterBody {
  filePath: string;
  key: string;
  force?: boolean;
  chatSessionId?: string;
}

interface UploadCharacterImageBody {
  filePath: string;
  key: string;
  imageData: string; // base64 data URI
}

type CharacterImageResponse = { image: string | null } | ErrorResponse;

router.get(
  API_ROUTES.mulmoScript.characterImage,
  async (req: Request<object, CharacterImageResponse, object, CharacterImageQuery>, res: Response<CharacterImageResponse>) => {
    const { filePath, key } = req.query;

    if (!filePath || !key) {
      badRequest(res, "filePath and key are required");
      return;
    }

    await withStoryContext(res, filePath, {}, async ({ context }) => {
      const imagePath = getReferenceImagePath(context, key, "png");
      if (!existsSync(imagePath)) {
        res.json({ image: null });
        return;
      }
      res.json({ image: fileToDataUri(imagePath, "image/png") });
    });
  },
);

router.post(API_ROUTES.mulmoScript.uploadBeatImage, async (req: Request<object, BeatImageResponse, UploadBeatImageBody>, res: Response<BeatImageResponse>) => {
  const { filePath, beatIndex, imageData } = req.body;

  if (!filePath || beatIndex === undefined || !imageData) {
    badRequest(res, "filePath, beatIndex, and imageData are required");
    return;
  }

  await withStoryContext(res, filePath, {}, async ({ context }) => {
    const { imagePath } = getBeatPngImagePath(context, beatIndex);
    // writeFileAtomic creates parent dirs and prevents a half-
    // written PNG from surviving a crash mid-write (#881 v2).
    const base64 = stripDataUri(imageData);
    await writeFileAtomic(imagePath, Buffer.from(base64, "base64"));

    res.json({ image: fileToDataUri(imagePath, "image/png") });
  });
});

router.post(
  API_ROUTES.mulmoScript.renderCharacter,
  async (req: Request<object, CharacterImageResponse, RenderCharacterBody>, res: Response<CharacterImageResponse>) => {
    const { filePath, key, force, chatSessionId } = req.body;

    if (!filePath || !key) {
      badRequest(res, "filePath and key are required");
      return;
    }

    publishGeneration(chatSessionId, GENERATION_KINDS.characterImage, filePath, key, false);
    let genError: string | undefined;
    try {
      await withStoryContext(res, filePath, { force }, async ({ context }) => {
        try {
          const images = context.studio.script.imageParams?.images ?? {};
          const imageEntry = images[key];
          if (!imageEntry || imageEntry.type !== "imagePrompt") {
            genError = `No imagePrompt entry for key: ${key}`;
            badRequest(res, genError);
            return;
          }

          const index = Object.keys(images).indexOf(key);
          const imagePath = getReferenceImagePath(context, key, "png");
          mkdirSync(path.dirname(imagePath), { recursive: true });

          await generateReferenceImage({
            context,
            key,
            index,
            image: imageEntry as MulmoImagePromptMedia,
            force,
          });
          if (!existsSync(imagePath)) {
            genError = "Character image was not generated";
            serverError(res, genError);
            return;
          }
          res.json({ image: fileToDataUri(imagePath, "image/png") });
        } catch (err) {
          genError = errorMessage(err);
          throw err;
        }
      });
    } finally {
      publishGeneration(chatSessionId, GENERATION_KINDS.characterImage, filePath, key, true, genError);
    }
  },
);

router.post(
  API_ROUTES.mulmoScript.uploadCharacterImage,
  async (req: Request<object, CharacterImageResponse, UploadCharacterImageBody>, res: Response<CharacterImageResponse>) => {
    const { filePath, key, imageData } = req.body;

    if (!filePath || !key || !imageData) {
      badRequest(res, "filePath, key, and imageData are required");
      return;
    }

    await withStoryContext(res, filePath, {}, async ({ context }) => {
      const imagePath = getReferenceImagePath(context, key, "png");
      // writeFileAtomic creates parent dirs and prevents a half-
      // written PNG from surviving a crash mid-write (#881 v2).
      const base64 = stripDataUri(imageData);
      await writeFileAtomic(imagePath, Buffer.from(base64, "base64"));

      res.json({ image: fileToDataUri(imagePath, "image/png") });
    });
  },
);

router.get(API_ROUTES.mulmoScript.downloadMovie, (req: Request, res: Response) => {
  const moviePath = getOptionalStringQuery(req, "moviePath");

  if (!moviePath) {
    badRequest(res, "moviePath is required");
    return;
  }

  const absolutePath = resolveStoryPath(moviePath, res);
  if (!absolutePath) return;

  res.download(absolutePath);
});

export default router;
