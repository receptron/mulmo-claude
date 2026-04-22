import { Router, Request, Response } from "express";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import path from "path";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { stripDataUri } from "../../utils/files/image-store.js";
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
import type { MulmoBeat, MulmoImagePromptMedia } from "@mulmocast/types";
import { slugify } from "../../utils/slug.js";
import { resolveWithinRoot } from "../../utils/files/safe.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, notFound, serverError } from "../../utils/httpError.js";
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
  script: MulmoScript;
  filename?: string;
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

router.post(API_ROUTES.mulmoScript.save, (req: Request<object, object, SaveMulmoScriptBody>, res: Response) => {
  const { script, filename } = req.body;

  if (!script || !Array.isArray(script.beats)) {
    badRequest(res, "script with beats array is required");
    return;
  }

  mkdirSync(storiesDir, { recursive: true });

  const title = script.title || "untitled";
  const slug = filename ? filename.replace(/\.json$/, "") : slugify(title);
  const fname = `${slug}-${Date.now()}.json`;
  const filePath = path.join(storiesDir, fname);

  writeFileSync(filePath, JSON.stringify(script, null, 2));

  res.json({
    data: { script, filePath: `stories/${fname}` },
    message: `Saved MulmoScript to stories/${fname}`,
    instructions: "Display the storyboard to the user.",
  });
});

router.post(API_ROUTES.mulmoScript.updateBeat, (req: Request<object, object, unknown>, res: Response) => {
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
  writeFileSync(absoluteFilePath, JSON.stringify(script, null, 2));

  res.json({ ok: true });
});

router.post(API_ROUTES.mulmoScript.updateScript, (req: Request<object, object, unknown>, res: Response) => {
  const validation = validateUpdateScriptBody(req.body);
  if (!validation.ok) {
    badRequest(res, validation.error);
    return;
  }
  const { filePath, script: updatedScript } = validation.value;

  const absoluteFilePath = resolveStoryPath(filePath, res);
  if (!absoluteFilePath) return;

  writeFileSync(absoluteFilePath, JSON.stringify(updatedScript, null, 2));
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

router.post(API_ROUTES.mulmoScript.generateMovie, async (req: Request<object, object, { filePath: string; chatSessionId?: string }>, res: Response) => {
  const { filePath, chatSessionId } = req.body;

  if (!filePath) {
    badRequest(res, "filePath is required");
    return;
  }

  const absoluteFilePath = resolveStoryPath(filePath, res);
  if (!absoluteFilePath) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  publishGeneration(chatSessionId, GENERATION_KINDS.movie, filePath, "", false);
  let genError: string | undefined;
  try {
    const context = await buildContext(absoluteFilePath);
    if (!context) {
      genError = "Failed to initialize mulmo context";
      send({ type: "error", message: genError });
      res.end();
      return;
    }

    // Build id → beatIndex map for the progress callback
    const idToIndex = new Map<string, number>();
    (context.studio.script.beats as MulmoBeat[]).forEach((beat, index) => {
      const key = beat.id ?? `__index__${index}`;
      idToIndex.set(key, index);
    });

    const onProgress = (event: { kind: string; sessionType: string; id?: string; inSession: boolean }) => {
      if (event.kind === "beat" && !event.inSession && event.id !== undefined) {
        const beatIndex = idToIndex.get(event.id);
        if (beatIndex !== undefined) {
          send({ type: `beat_${event.sessionType}_done`, beatIndex });
        }
      }
    };

    addSessionProgressCallback(onProgress);
    try {
      const imagesContext = await images(context);
      const audioContext = await audio(imagesContext);
      await movie(audioContext);

      const outputPath = movieFilePath(audioContext);
      if (!existsSync(outputPath)) {
        genError = "Movie was not generated";
        send({ type: "error", message: genError });
        res.end();
        return;
      }

      send({ type: "done", moviePath: toStoryRef(outputPath) });
    } finally {
      removeSessionProgressCallback(onProgress);
    }
  } catch (err) {
    genError = errorMessage(err);
    send({ type: "error", message: genError });
  } finally {
    publishGeneration(chatSessionId, GENERATION_KINDS.movie, filePath, "", true, genError);
    res.end();
  }
});

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
    mkdirSync(path.dirname(imagePath), { recursive: true });

    const base64 = stripDataUri(imageData);
    writeFileSync(imagePath, Buffer.from(base64, "base64"));

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
      mkdirSync(path.dirname(imagePath), { recursive: true });

      const base64 = stripDataUri(imageData);
      writeFileSync(imagePath, Buffer.from(base64, "base64"));

      res.json({ image: fileToDataUri(imagePath, "image/png") });
    });
  },
);

router.get(API_ROUTES.mulmoScript.downloadMovie, (req: Request, res: Response) => {
  const moviePath = typeof req.query.moviePath === "string" ? req.query.moviePath : undefined;

  if (!moviePath) {
    badRequest(res, "moviePath is required");
    return;
  }

  const absolutePath = resolveStoryPath(moviePath, res);
  if (!absolutePath) return;

  res.download(absolutePath);
});

export default router;
