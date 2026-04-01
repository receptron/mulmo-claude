import { Router, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { workspacePath } from "../workspace.js";

const router = Router();
const HTML_FILE = () => path.join(workspacePath, "html", "current.html");

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey });
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

router.post(
  "/generate-html",
  async (req: Request<object, unknown, HtmlPromptBody>, res: Response) => {
    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ message: "prompt is required" });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
      res.status(500).json({ message: "GEMINI_API_KEY is not set" });
      return;
    }
    try {
      const fullPrompt = `Generate a complete, standalone HTML page based on this description: ${prompt}\n\nRequirements:\n- Self-contained with all CSS and JS inline\n- Use Tailwind CSS via CDN if needed\n- Return only the HTML code, no explanation`;
      const html = await callGemini(fullPrompt);
      const htmlDir = path.join(workspacePath, "html");
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
      res
        .status(500)
        .json({ message: err instanceof Error ? err.message : String(err) });
    }
  },
);

router.post(
  "/edit-html",
  async (req: Request<object, unknown, HtmlPromptBody>, res: Response) => {
    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ message: "prompt is required" });
      return;
    }
    if (!process.env.GEMINI_API_KEY) {
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
      res
        .status(500)
        .json({ message: err instanceof Error ? err.message : String(err) });
    }
  },
);

export default router;
