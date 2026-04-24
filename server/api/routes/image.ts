import { Router, Request, Response } from "express";
import { getOptionalStringQuery } from "../../utils/request.js";
import { getSessionImageData } from "../../events/session-store/index.js";
import { generateGeminiImageContent, generateGeminiImageFromPrompt } from "../../utils/gemini.js";
import { errorMessage } from "../../utils/errors.js";
import { badRequest, serverError } from "../../utils/httpError.js";
import { saveImage, overwriteImage, loadImageBase64, stripDataUri, isImagePath } from "../../utils/files/image-store.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

const router = Router();

// ── Shared response helpers ──────────────────────────────────────

interface ImageSuccessResponse {
  message: string;
  instructions?: string;
  title?: string;
  data?: { imageData: string; prompt: string };
}

interface ImageErrorResponse {
  success: false;
  message: string;
}

type ImageResponse = ImageSuccessResponse | ImageErrorResponse;

// Shared save-and-respond for /generate-image and /edit-image. The
// only difference between the two routes is how they obtain the raw
// imageData from Gemini — once that's done, the "save to disk and
// build the JSON response" step is identical.
async function respondWithImage(
  res: Response<ImageResponse>,
  imageData: string | undefined,
  fallbackMessage: string | undefined,
  prompt: string,
  kind: "generation" | "edit",
): Promise<void> {
  if (!imageData) {
    res.json({ message: fallbackMessage ?? "no image data in response" });
    return;
  }
  const imagePath = await saveImage(imageData);
  const label = kind === "generation" ? "Generated" : "Edited";
  res.json({
    message: `image ${kind} succeeded`,
    instructions: `Acknowledge that the image was ${kind === "generation" ? "generated" : "edited"} and has been presented to the user.`,
    title: `${label} Image`,
    data: { imageData: imagePath, prompt },
  });
}

// ── Canvas image storage routes ──────────────────────────────────

interface CanvasImageBody {
  imageData: string;
}

interface CanvasImageResponse {
  path: string;
}

interface CanvasImageError {
  error: string;
}

async function saveCanvasImage(
  res: Response<CanvasImageResponse | CanvasImageError>,
  base64: string,
  writeFn: (b64: string) => Promise<string>,
): Promise<void> {
  try {
    const imagePath = await writeFn(base64);
    res.json({ path: imagePath });
  } catch (err) {
    serverError(res, errorMessage(err));
  }
}

// ── Routes ───────────────────────────────────────────────────────

interface GenerateImageBody {
  prompt: string;
  model?: string;
}

router.post(API_ROUTES.image.generate, async (req: Request<object, unknown, GenerateImageBody>, res: Response<ImageResponse>) => {
  const { prompt, model } = req.body;
  if (!prompt) {
    res.status(400).json({ success: false, message: "prompt is required" });
    return;
  }
  try {
    const { imageData, message } = await generateGeminiImageFromPrompt(prompt, model);
    await respondWithImage(res, imageData, message, prompt, "generation");
  } catch (err) {
    res.status(500).json({ success: false, message: errorMessage(err) });
  }
});

interface EditImageBody {
  prompt: string;
}

router.post(API_ROUTES.image.edit, async (req: Request<object, unknown, EditImageBody>, res: Response<ImageResponse>) => {
  const { prompt } = req.body;
  const session = getOptionalStringQuery(req, "session");
  if (!prompt) {
    res.status(400).json({ success: false, message: "prompt is required" });
    return;
  }
  const currentImageData = session ? getSessionImageData(session) : undefined;
  if (!currentImageData) {
    res.status(400).json({
      success: false,
      message: "No image is selected. Please click an image in the sidebar first, then ask me to edit it.",
    });
    return;
  }
  try {
    // Resolve input image to raw base64 — supports both file paths and legacy data URIs
    const base64Data = isImagePath(currentImageData) ? await loadImageBase64(currentImageData) : stripDataUri(currentImageData);
    // /edit-image deliberately omits `config` (no aspectRatio) so
    // Gemini preserves the input image's dimensions.
    const { imageData, message } = await generateGeminiImageContent([
      {
        parts: [{ inlineData: { mimeType: "image/png", data: base64Data } }, { text: prompt }],
      },
    ]);
    await respondWithImage(res, imageData, message, prompt, "edit");
  } catch (err) {
    res.status(500).json({ success: false, message: errorMessage(err) });
  }
});

// Canvas image persistence — POST creates a new file, PUT overwrites.

router.post(API_ROUTES.image.upload, async (req: Request<object, unknown, CanvasImageBody>, res: Response<CanvasImageResponse | CanvasImageError>) => {
  const { imageData } = req.body;
  if (!imageData) {
    badRequest(res, "imageData is required");
    return;
  }
  const base64 = stripDataUri(imageData);
  await saveCanvasImage(res, base64, async (b64) => saveImage(b64));
});

interface UpdateImageBody extends CanvasImageBody {
  relativePath: string;
}

// Canvas saves come in with the workspace-relative path the file
// already lives at (returned at canvas creation), so the client never
// has to know how `saveImage` shards by YYYY/MM. The server validates
// the prefix + extension via `isImagePath`; `safeResolve` inside
// `overwriteImage` blocks any traversal.
router.put(API_ROUTES.image.update, async (req: Request<object, unknown, UpdateImageBody>, res: Response<CanvasImageResponse | CanvasImageError>) => {
  const { relativePath, imageData } = req.body;
  if (!relativePath || !isImagePath(relativePath)) {
    badRequest(res, "invalid image relativePath");
    return;
  }
  if (!imageData) {
    badRequest(res, "imageData is required");
    return;
  }
  const base64 = stripDataUri(imageData);
  await saveCanvasImage(res, base64, async (b64) => {
    await overwriteImage(relativePath, b64);
    return relativePath;
  });
});

export default router;
