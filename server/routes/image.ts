import { Router, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { getSessionImageData } from "../sessions.js";

const router = Router();

interface GenerateImageBody {
  prompt: string;
  model?: string;
}

router.post(
  "/generate-image",
  async (req: Request<object, unknown, GenerateImageBody>, res: Response) => {
    const { prompt, model } = req.body;

    if (!prompt) {
      res.status(400).json({ success: false, message: "prompt is required" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res
        .status(500)
        .json({ success: false, message: "GEMINI_API_KEY is not set" });
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const modelName = model ?? "gemini-3.1-flash-image-preview";

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [{ text: prompt }],
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: "16:9" },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      let imageData: string | undefined;
      let message: string | undefined;

      for (const part of parts) {
        if (part.text) message = part.text;
        if (part.inlineData?.data) imageData = part.inlineData.data;
      }

      if (imageData) {
        res.json({
          message: "image generation succeeded",
          instructions:
            "Acknowledge that the image was generated and has been presented to the user.",
          title: "Generated Image",
          data: {
            imageData: `data:image/png;base64,${imageData}`,
            prompt,
          },
        });
      } else {
        res.json({ message: message ?? "no image data in response" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: msg });
    }
  },
);

interface EditImageBody {
  prompt: string;
}

router.post(
  "/edit-image",
  async (req: Request<object, unknown, EditImageBody>, res: Response) => {
    const { prompt } = req.body;
    const session = req.query.session as string | undefined;

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res
        .status(500)
        .json({ success: false, message: "GEMINI_API_KEY is not set" });
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const modelName = "gemini-3.1-flash-image-preview";
      const base64Data = currentImageData.replace(
        /^data:image\/[^;]+;base64,/,
        "",
      );

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            parts: [
              { inlineData: { mimeType: "image/png", data: base64Data } },
              { text: prompt },
            ],
          },
        ],
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      let imageData: string | undefined;
      let message: string | undefined;

      for (const part of parts) {
        if (part.text) message = part.text;
        if (part.inlineData?.data) imageData = part.inlineData.data;
      }

      if (imageData) {
        res.json({
          message: "image edit succeeded",
          instructions:
            "Acknowledge that the image was edited and has been presented to the user.",
          title: "Edited Image",
          data: {
            imageData: `data:image/png;base64,${imageData}`,
            prompt,
          },
        });
      } else {
        res.json({ message: message ?? "no image data in response" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, message: msg });
    }
  },
);

export default router;
