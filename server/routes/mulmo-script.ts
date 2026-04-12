import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../workspace.js";
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
import { slugify } from "../utils/slug.js";
import { resolveWithinRoot } from "../utils/fs.js";
import { errorMessage } from "../utils/errors.js";

const router = Router();
const storiesDir = path.resolve(workspacePath, "stories");

// Lazily realpath the stories dir on first use. We can't realpath at
// module load because the directory may not exist yet (it's created
// on demand by /mulmo-script POST). The cache is invalidated never —
// once the dir exists, its realpath is stable.
let storiesRealCache: string | null = null;
function ensureStoriesReal(): string | null {
  if (storiesRealCache) return storiesRealCache;
  try {
    fs.mkdirSync(storiesDir, { recursive: true });
    storiesRealCache = fs.realpathSync(storiesDir);
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
}

interface UploadBeatImageBody {
  filePath: string;
  beatIndex: number;
  imageData: string; // base64 data URI
}

interface UpdateBeatBody {
  filePath: string;
  beatIndex: number;
  beat: MulmoBeat;
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

router.post(
  "/mulmo-script",
  (req: Request<object, object, SaveMulmoScriptBody>, res: Response) => {
    const { script, filename } = req.body;

    if (!script || !Array.isArray(script.beats)) {
      res.status(400).json({ error: "script with beats array is required" });
      return;
    }

    fs.mkdirSync(storiesDir, { recursive: true });

    const title = script.title || "untitled";
    const slug = filename ? filename.replace(/\.json$/, "") : slugify(title);
    const fname = `${slug}-${Date.now()}.json`;
    const filePath = path.join(storiesDir, fname);

    fs.writeFileSync(filePath, JSON.stringify(script, null, 2));

    res.json({
      data: { script, filePath: `stories/${fname}` },
      message: `Saved MulmoScript to stories/${fname}`,
      instructions: "Display the storyboard to the user.",
    });
  },
);

router.post(
  "/mulmo-script/update-beat",
  (req: Request<object, object, UpdateBeatBody>, res: Response) => {
    const { filePath, beatIndex, beat } = req.body;

    if (!filePath || beatIndex === undefined || !beat) {
      res
        .status(400)
        .json({ error: "filePath, beatIndex, and beat are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    const script: MulmoScript = JSON.parse(
      fs.readFileSync(absoluteFilePath, "utf-8"),
    );

    if (!Array.isArray(script.beats) || beatIndex >= script.beats.length) {
      res.status(400).json({ error: "Invalid beatIndex" });
      return;
    }

    script.beats[beatIndex] = beat;
    fs.writeFileSync(absoluteFilePath, JSON.stringify(script, null, 2));

    res.json({ ok: true });
  },
);

router.get(
  "/mulmo-script/beat-image",
  async (
    req: Request<object, BeatImageResponse, object, BeatQuery>,
    res: Response<BeatImageResponse>,
  ) => {
    const { filePath, beatIndex: beatIndexStr } = req.query;
    const beatIndex =
      beatIndexStr !== undefined ? parseInt(beatIndexStr, 10) : undefined;

    if (!filePath || beatIndex === undefined || isNaN(beatIndex)) {
      res.status(400).json({ error: "filePath and beatIndex are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    try {
      const context = await buildContext(absoluteFilePath);
      if (!context) {
        res.status(500).json({ error: "Failed to initialize mulmo context" });
        return;
      }

      const { imagePath } = getBeatPngImagePath(context, beatIndex);

      if (!fs.existsSync(imagePath)) {
        res.json({ image: null });
        return;
      }

      res.json({ image: fileToDataUri(imagePath, "image/png") });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.get(
  "/mulmo-script/movie-status",
  async (
    req: Request<object, MovieStatusResponse, object, FilePathQuery>,
    res: Response<MovieStatusResponse>,
  ) => {
    const { filePath } = req.query;

    if (!filePath) {
      res.status(400).json({ error: "filePath is required" });
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
      if (!fs.existsSync(outputPath)) {
        res.json({ moviePath: null });
        return;
      }

      const movieMtime = fs.statSync(outputPath).mtimeMs;
      const sourceMtime = fs.statSync(absoluteFilePath).mtimeMs;
      if (movieMtime < sourceMtime) {
        res.json({ moviePath: null });
        return;
      }

      const relPath = path.relative(workspacePath, outputPath);
      res.json({ moviePath: relPath });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

function fileToDataUri(filePath: string, mimeType: string): string {
  const data = fs.readFileSync(filePath);
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
    res.status(500).json({ error: "stories directory not available" });
    return null;
  }
  // Reject absolute paths and parent traversal at the syntactic
  // level — defense in depth on top of the realpath check below.
  if (path.isAbsolute(filePath)) {
    res.status(400).json({ error: "Invalid filePath" });
    return null;
  }
  // Strip the optional "stories/" prefix so the remainder is a path
  // relative to storiesReal. Accepts both "stories/foo.json" (the
  // canonical caller convention) and bare "foo.json".
  const STORIES_PREFIX = "stories" + path.sep;
  const relFromStories =
    filePath === "stories"
      ? ""
      : filePath.startsWith(STORIES_PREFIX) || filePath.startsWith("stories/")
        ? filePath.slice("stories/".length)
        : filePath;
  // resolveWithinRoot enforces both the realpath boundary AND
  // existence; ENOENT and traversal both produce null. Distinguish
  // them via a follow-up existsSync so 404 vs 400 stays accurate.
  const resolved = resolveWithinRoot(storiesReal, relFromStories);
  if (!resolved) {
    const candidate = path.resolve(storiesReal, relFromStories);
    if (!fs.existsSync(candidate)) {
      res.status(404).json({ error: `File not found: ${filePath}` });
    } else {
      res.status(400).json({ error: "Invalid filePath" });
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

router.get(
  "/mulmo-script/beat-audio",
  async (
    req: Request<object, BeatAudioResponse, object, BeatQuery>,
    res: Response<BeatAudioResponse>,
  ) => {
    const { filePath, beatIndex: beatIndexStr } = req.query;
    const beatIndex =
      beatIndexStr !== undefined ? parseInt(beatIndexStr, 10) : undefined;

    if (!filePath || beatIndex === undefined || isNaN(beatIndex)) {
      res.status(400).json({ error: "filePath and beatIndex are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    try {
      const context = await buildContext(absoluteFilePath);
      if (!context) {
        res.json({ audio: null });
        return;
      }

      const beat = context.studio.script.beats[beatIndex];
      const audioPath = getBeatAudioPathOrUrl(
        beat.text ?? "",
        context,
        beat,
        context.lang,
      );
      if (!audioPath || !fs.existsSync(audioPath)) {
        res.json({ audio: null });
        return;
      }

      res.json({ audio: fileToDataUri(audioPath, "audio/mpeg") });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.post(
  "/mulmo-script/generate-beat-audio",
  async (
    req: Request<
      object,
      object,
      { filePath: string; beatIndex: number; force?: boolean }
    >,
    res: Response<GenerateBeatAudioResponse>,
  ) => {
    const { filePath, beatIndex, force } = req.body;

    if (!filePath || beatIndex === undefined) {
      res.status(400).json({ error: "filePath and beatIndex are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    try {
      const context = await buildContext(absoluteFilePath, force);
      if (!context) {
        res.status(500).json({ error: "Failed to initialize mulmo context" });
        return;
      }

      await generateBeatAudio(beatIndex, context, {
        settings: process.env as Record<string, string>,
      } as Parameters<typeof generateBeatAudio>[2]);

      const beat = context.studio.script.beats[beatIndex];
      const audioPath =
        context.studio.beats[beatIndex]?.audioFile ??
        getBeatAudioPathOrUrl(beat.text ?? "", context, beat, context.lang);

      if (!audioPath || !fs.existsSync(audioPath)) {
        console.error(
          `[generate-beat-audio] failed: beatIndex=${beatIndex} audioPath=${audioPath} exists=${audioPath ? fs.existsSync(audioPath) : false}`,
        );
        console.error(
          `[generate-beat-audio] beat.text=${JSON.stringify(beat.text)} audioFile=${context.studio.beats[beatIndex]?.audioFile}`,
        );
        res.status(500).json({ error: "Audio was not generated" });
        return;
      }

      res.json({ audio: fileToDataUri(audioPath, "audio/mpeg") });
    } catch (err) {
      console.error("[generate-beat-audio] error:", err);
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.post(
  "/mulmo-script/render-beat",
  async (req: Request<object, object, RenderBeatBody>, res: Response) => {
    const { filePath, beatIndex, force } = req.body;

    if (!filePath || beatIndex === undefined) {
      res.status(400).json({ error: "filePath and beatIndex are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    try {
      const context = await buildContext(absoluteFilePath, force);
      if (!context) {
        res.status(500).json({ error: "Failed to initialize mulmo context" });
        return;
      }

      await generateBeatImage({
        index: beatIndex,
        context,
        args: force ? { forceImage: true } : undefined,
      });

      const { imagePath } = getBeatPngImagePath(context, beatIndex);

      if (!fs.existsSync(imagePath)) {
        res.status(500).json({ error: "Image was not generated" });
        return;
      }

      res.json({ image: fileToDataUri(imagePath, "image/png") });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.post(
  "/mulmo-script/generate-movie",
  async (req: Request<object, object, { filePath: string }>, res: Response) => {
    const { filePath } = req.body;

    if (!filePath) {
      res.status(400).json({ error: "filePath is required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: unknown) =>
      res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const context = await buildContext(absoluteFilePath);
      if (!context) {
        send({ type: "error", message: "Failed to initialize mulmo context" });
        res.end();
        return;
      }

      // Build id → beatIndex map for the progress callback
      const idToIndex = new Map<string, number>();
      (context.studio.script.beats as MulmoBeat[]).forEach((beat, index) => {
        const key = beat.id ?? `__index__${index}`;
        idToIndex.set(key, index);
      });

      const onProgress = (event: {
        kind: string;
        sessionType: string;
        id?: string;
        inSession: boolean;
      }) => {
        if (
          event.kind === "beat" &&
          !event.inSession &&
          event.id !== undefined
        ) {
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
        if (!fs.existsSync(outputPath)) {
          send({ type: "error", message: "Movie was not generated" });
          res.end();
          return;
        }

        const relPath = path.relative(workspacePath, outputPath);
        send({ type: "done", moviePath: relPath });
      } finally {
        removeSessionProgressCallback(onProgress);
      }
    } catch (err) {
      send({ type: "error", message: errorMessage(err) });
    } finally {
      res.end();
    }
  },
);

interface CharacterImageQuery {
  filePath?: string;
  key?: string;
}

interface RenderCharacterBody {
  filePath: string;
  key: string;
  force?: boolean;
}

interface UploadCharacterImageBody {
  filePath: string;
  key: string;
  imageData: string; // base64 data URI
}

type CharacterImageResponse = { image: string | null } | ErrorResponse;

router.get(
  "/mulmo-script/character-image",
  async (
    req: Request<object, CharacterImageResponse, object, CharacterImageQuery>,
    res: Response<CharacterImageResponse>,
  ) => {
    const { filePath, key } = req.query;

    if (!filePath || !key) {
      res.status(400).json({ error: "filePath and key are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    try {
      const context = await buildContext(absoluteFilePath);
      if (!context) {
        res.status(500).json({ error: "Failed to initialize mulmo context" });
        return;
      }

      const imagePath = getReferenceImagePath(context, key, "png");
      if (!fs.existsSync(imagePath)) {
        res.json({ image: null });
        return;
      }

      res.json({ image: fileToDataUri(imagePath, "image/png") });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.post(
  "/mulmo-script/upload-beat-image",
  async (
    req: Request<object, BeatImageResponse, UploadBeatImageBody>,
    res: Response<BeatImageResponse>,
  ) => {
    const { filePath, beatIndex, imageData } = req.body;

    if (!filePath || beatIndex === undefined || !imageData) {
      res
        .status(400)
        .json({ error: "filePath, beatIndex, and imageData are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    try {
      const context = await buildContext(absoluteFilePath);
      if (!context) {
        res.status(500).json({ error: "Failed to initialize mulmo context" });
        return;
      }

      const { imagePath } = getBeatPngImagePath(context, beatIndex);
      fs.mkdirSync(path.dirname(imagePath), { recursive: true });

      const base64 = imageData.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(imagePath, Buffer.from(base64, "base64"));

      res.json({ image: fileToDataUri(imagePath, "image/png") });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.post(
  "/mulmo-script/render-character",
  async (
    req: Request<object, CharacterImageResponse, RenderCharacterBody>,
    res: Response<CharacterImageResponse>,
  ) => {
    const { filePath, key, force } = req.body;

    if (!filePath || !key) {
      res.status(400).json({ error: "filePath and key are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    try {
      const context = await buildContext(absoluteFilePath, force);
      if (!context) {
        res.status(500).json({ error: "Failed to initialize mulmo context" });
        return;
      }

      const images = context.studio.script.imageParams?.images ?? {};
      const imageEntry = images[key];
      if (!imageEntry || imageEntry.type !== "imagePrompt") {
        res.status(400).json({ error: `No imagePrompt entry for key: ${key}` });
        return;
      }

      const index = Object.keys(images).indexOf(key);
      const imagePath = getReferenceImagePath(context, key, "png");
      fs.mkdirSync(path.dirname(imagePath), { recursive: true });

      await generateReferenceImage({
        context,
        key,
        index,
        image: imageEntry as MulmoImagePromptMedia,
        force,
      });
      if (!fs.existsSync(imagePath)) {
        res.status(500).json({ error: "Character image was not generated" });
        return;
      }

      res.json({ image: fileToDataUri(imagePath, "image/png") });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.post(
  "/mulmo-script/upload-character-image",
  async (
    req: Request<object, CharacterImageResponse, UploadCharacterImageBody>,
    res: Response<CharacterImageResponse>,
  ) => {
    const { filePath, key, imageData } = req.body;

    if (!filePath || !key || !imageData) {
      res
        .status(400)
        .json({ error: "filePath, key, and imageData are required" });
      return;
    }

    const absoluteFilePath = resolveStoryPath(filePath, res);
    if (!absoluteFilePath) return;

    try {
      const context = await buildContext(absoluteFilePath);
      if (!context) {
        res.status(500).json({ error: "Failed to initialize mulmo context" });
        return;
      }

      const imagePath = getReferenceImagePath(context, key, "png");
      fs.mkdirSync(path.dirname(imagePath), { recursive: true });

      const base64 = imageData.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(imagePath, Buffer.from(base64, "base64"));

      res.json({ image: fileToDataUri(imagePath, "image/png") });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.get("/mulmo-script/download-movie", (req: Request, res: Response) => {
  const moviePath =
    typeof req.query.moviePath === "string" ? req.query.moviePath : undefined;

  if (!moviePath) {
    res.status(400).json({ error: "moviePath is required" });
    return;
  }

  const absolutePath = resolveStoryPath(moviePath, res);
  if (!absolutePath) return;

  res.download(absolutePath);
});

export default router;
