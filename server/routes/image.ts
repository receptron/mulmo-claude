import { Router, Request, Response } from "express";
import { getSessionImageData } from "../sessions.js";
import {
  generateGeminiImageContent,
  generateGeminiImageFromPrompt,
} from "../utils/gemini.js";
import { errorMessage } from "../utils/errors.js";
import {
  saveImage,
  overwriteImage,
  loadImageBase64,
  stripDataUri,
  isImagePath,
} from "../utils/image-store.js";

const router = Router();

interface GenerateImageBody {
  prompt: string;
  model?: string;
}

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

router.post(
  "/generate-image",
  async (
    req: Request<object, unknown, GenerateImageBody>,
    res: Response<ImageResponse>,
  ) => {
    const { prompt, model } = req.body;

    if (!prompt) {
      res.status(400).json({ success: false, message: "prompt is required" });
      return;
    }

    try {
      const { imageData, message } = await generateGeminiImageFromPrompt(
        prompt,
        model,
      );
      if (imageData) {
        const imagePath = await saveImage(imageData);
        res.json({
          message: "image generation succeeded",
          instructions:
            "Acknowledge that the image was generated and has been presented to the user.",
          title: "Generated Image",
          data: {
            imageData: imagePath,
            prompt,
          },
        });
      } else {
        res.json({ message: message ?? "no image data in response" });
      }
    } catch (err) {
      res.status(500).json({ success: false, message: errorMessage(err) });
    }
  },
);

interface EditImageBody {
  prompt: string;
}

router.post(
  "/edit-image",
  async (
    req: Request<object, unknown, EditImageBody>,
    res: Response<ImageResponse>,
  ) => {
    const { prompt } = req.body;
    const session =
      typeof req.query.session === "string" ? req.query.session : undefined;

    if (!prompt) {
      res.status(400).json({ success: false, message: "prompt is required" });
      return;
    }

    const currentImageData = session ? getSessionImageData(session) : undefined;
    if (!currentImageData) {
      res.status(400).json({
        success: false,
        message:
          "No image is selected. Please click an image in the sidebar first, then ask me to edit it.",
      });
      return;
    }

    try {
      // Resolve input image to raw base64 — supports both file paths and legacy data URIs
      const base64Data = isImagePath(currentImageData)
        ? await loadImageBase64(currentImageData)
        : stripDataUri(currentImageData);
      // /edit-image deliberately omits `config` (no aspectRatio) so
      // Gemini preserves the input image's dimensions.
      const { imageData, message } = await generateGeminiImageContent([
        {
          parts: [
            { inlineData: { mimeType: "image/png", data: base64Data } },
            { text: prompt },
          ],
        },
      ]);
      if (imageData) {
        const imagePath = await saveImage(imageData);
        res.json({
          message: "image edit succeeded",
          instructions:
            "Acknowledge that the image was edited and has been presented to the user.",
          title: "Edited Image",
          data: {
            imageData: imagePath,
            prompt,
          },
        });
      } else {
        res.json({ message: message ?? "no image data in response" });
      }
    } catch (err) {
      res.status(500).json({ success: false, message: errorMessage(err) });
    }
  },
);

// Canvas image storage — POST creates a new file, PUT overwrites existing

interface CanvasImageBody {
  imageData: string;
}

interface CanvasImageResponse {
  path: string;
}

interface CanvasImageError {
  error: string;
}

router.post(
  "/images",
  async (
    req: Request<object, unknown, CanvasImageBody>,
    res: Response<CanvasImageResponse | CanvasImageError>,
  ) => {
    const { imageData } = req.body;
    if (!imageData) {
      res.status(400).json({ error: "imageData is required" });
      return;
    }
    try {
      const base64 = stripDataUri(imageData);
      const imagePath = await saveImage(base64);
      res.json({ path: imagePath });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

router.put(
  "/images/:filename",
  async (
    req: Request<{ filename: string }, unknown, CanvasImageBody>,
    res: Response<CanvasImageResponse | CanvasImageError>,
  ) => {
    const relativePath = `images/${req.params.filename}`;
    const { imageData } = req.body;
    if (!imageData || !relativePath) {
      res.status(400).json({ error: "imageData and path are required" });
      return;
    }
    if (!isImagePath(relativePath)) {
      res.status(400).json({ error: "invalid image path" });
      return;
    }
    try {
      const base64 = stripDataUri(imageData);
      await overwriteImage(relativePath, base64);
      res.json({ path: relativePath });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  },
);

export default router;
