import { Router, Request, Response } from "express";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { WORKSPACE_PATHS } from "../workspace-paths.js";
import { getGeminiClient, isGeminiAvailable } from "../utils/gemini.js";
import { errorMessage } from "../utils/errors.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";

const router = Router();
const HTML_FILE = () => path.join(WORKSPACE_PATHS.html, "current.html");

async function callGemini(prompt: string): Promise<string> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ text: prompt }],
  });
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  // Strip markdown code fences if present
  return text
    .replace(/^```html\n?/, "")
    .replace(/^```\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

interface HtmlPromptBody {
  prompt: string;
}

interface HtmlSuccessResponse {
  message: string;
  instructions?: string;
  title?: string;
  data?: { html: string; type: string };
  updating?: boolean;
}

interface HtmlErrorResponse {
  message: string;
}

type HtmlResponse = HtmlSuccessResponse | HtmlErrorResponse;

router.post(
  API_ROUTES.html.generate,
  async (
    req: Request<object, unknown, HtmlPromptBody>,
    res: Response<HtmlResponse>,
  ) => {
    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ message: "prompt is required" });
      return;
    }
    if (!isGeminiAvailable()) {
      res.status(500).json({ message: "GEMINI_API_KEY is not set" });
      return;
    }
    try {
      const fullPrompt = `Generate a complete, standalone HTML page based on this description: ${prompt}\n\nRequirements:\n- Self-contained with all CSS and JS inline\n- Use Tailwind CSS via CDN if needed\n- Return only the HTML code, no explanation`;
      const html = await callGemini(fullPrompt);
      const htmlDir = WORKSPACE_PATHS.html;
      await mkdir(htmlDir, { recursive: true });
      await writeFile(HTML_FILE(), html, "utf-8");
      res.json({
        message: "HTML generation succeeded",
        instructions:
          "Acknowledge that the HTML was generated and has been presented to the user.",
        title: prompt.slice(0, 50),
        data: { html, type: "tailwind" },
      });
    } catch (err) {
      res.status(500).json({ message: errorMessage(err) });
    }
  },
);

router.post(
  API_ROUTES.html.edit,
  async (
    req: Request<object, unknown, HtmlPromptBody>,
    res: Response<HtmlResponse>,
  ) => {
    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ message: "prompt is required" });
      return;
    }
    if (!isGeminiAvailable()) {
      res.status(500).json({ message: "GEMINI_API_KEY is not set" });
      return;
    }
    // eslint-disable-next-line no-useless-assignment
    let existingHtml = "";
    try {
      existingHtml = await readFile(HTML_FILE(), "utf-8");
    } catch {
      res.status(400).json({
        message: "No HTML page has been generated yet. Use generateHtml first.",
      });
      return;
    }
    try {
      const fullPrompt = `Modify the following HTML page based on this instruction: ${prompt}\n\nExisting HTML:\n${existingHtml}\n\nRequirements:\n- Return only the complete modified HTML, no explanation`;
      const html = await callGemini(fullPrompt);
      await writeFile(HTML_FILE(), html, "utf-8");
      res.json({
        message: "HTML editing succeeded",
        instructions:
          "Acknowledge that the HTML was modified and has been presented to the user.",
        title: prompt.slice(0, 50),
        data: { html, type: "tailwind" },
        updating: true,
      });
    } catch (err) {
      res.status(500).json({ message: errorMessage(err) });
    }
  },
);

export default router;
