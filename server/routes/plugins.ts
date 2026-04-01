import { Router, Request, Response } from "express";
import { executeMindMap } from "@gui-chat-plugin/mindmap";
import { executeSpreadsheet } from "@gui-chat-plugin/spreadsheet";
import { executeQuiz } from "@mulmochat-plugin/quiz";
import { executeForm } from "@mulmochat-plugin/form";
import { executeOpenCanvas } from "@gui-chat-plugin/canvas";
import { executePresent3D } from "@gui-chat-plugin/present3d";
import { executeOthello } from "@gui-chat-plugin/othello";
import { showMusic } from "@gui-chat-plugin/music";
import { GoogleGenAI } from "@google/genai";

const router = Router();

const IMAGE_PLACEHOLDER = /!\[([^\]]+)\]\(\/?__too_be_replaced_image_path__\)/g;

async function generateInlineImage(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: [{ text: prompt }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
      },
    });
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  } catch {
    // leave placeholder if generation fails
  }
  return null;
}

async function fillImagePlaceholders(markdown: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) return markdown;
  const matches = [...markdown.matchAll(IMAGE_PLACEHOLDER)];
  if (matches.length === 0) return markdown;

  const results = await Promise.all(
    matches.map(async (m) => ({
      full: m[0],
      prompt: m[1],
      url: await generateInlineImage(m[1]),
    })),
  );

  let filled = markdown;
  for (const { full, prompt, url } of results) {
    if (url) filled = filled.replace(full, `![${prompt}](${url})`);
  }
  return filled;
}

// presentDocument — fills image placeholders via Gemini if API key is available
interface PresentDocumentBody {
  title: string;
  markdown: string;
}

router.post(
  "/present-document",
  async (req: Request<object, unknown, PresentDocumentBody>, res: Response) => {
    const { title, markdown } = req.body;
    const filledMarkdown = await fillImagePlaceholders(markdown);
    res.json({
      message: `Document "${title}" is ready.`,
      title,
      data: { markdown: filledMarkdown },
    });
  },
);

// presentSpreadsheet — uses package execute for validation/processing
router.post("/present-spreadsheet", async (req: Request, res: Response) => {
  try {
    const result = await executeSpreadsheet(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

// createMindMap — uses package execute for node layout computation
router.post("/mindmap", async (req: Request, res: Response) => {
  try {
    const result = await executeMindMap(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

// putQuestions — quiz
router.post("/quiz", async (req: Request, res: Response) => {
  try {
    const result = await executeQuiz(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

// presentForm — form
router.post("/form", async (req: Request, res: Response) => {
  try {
    const result = await executeForm(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

// openCanvas — drawing canvas
router.post("/canvas", async (req: Request, res: Response) => {
  try {
    const result = await executeOpenCanvas(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

// present3d — 3D visualization
router.post("/present3d", async (req: Request, res: Response) => {
  try {
    const result = await executePresent3D(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

// playOthello — Othello/Reversi game
router.post("/othello", async (req: Request, res: Response) => {
  try {
    const result = await executeOthello(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

// showMusic — sheet music display
router.post("/music", async (req: Request, res: Response) => {
  try {
    const result = await showMusic(null as never, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: String(err) });
  }
});

export default router;
