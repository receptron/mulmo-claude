import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../workspace.js";
import {
  getFileObject,
  initializeContextFromFiles,
  generateBeatImage,
  getBeatPngImagePath,
  setGraphAILogger,
} from "mulmocast";

const router = Router();

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "script"
  );
}

router.post("/mulmo-script", (req: Request, res: Response) => {
  const { script, filename } = req.body as {
    script: Record<string, unknown>;
    filename?: string;
  };

  if (!script || !Array.isArray(script.beats)) {
    res.status(400).json({ error: "script with beats array is required" });
    return;
  }

  const storiesDir = path.join(workspacePath, "stories");
  fs.mkdirSync(storiesDir, { recursive: true });

  const title = (script.title as string) || "untitled";
  const slug = filename ? filename.replace(/\.json$/, "") : slugify(title);
  const fname = `${slug}-${Date.now()}.json`;
  const filePath = path.join(storiesDir, fname);

  fs.writeFileSync(filePath, JSON.stringify(script, null, 2));

  res.json({
    data: { script, filePath: `stories/${fname}` },
    message: `Saved MulmoScript to stories/${fname}`,
    instructions: "Display the storyboard to the user.",
  });
});

router.post(
  "/mulmo-script/render-beat",
  async (req: Request, res: Response) => {
    const { filePath, beatIndex } = req.body as {
      filePath: string; // relative to workspacePath, e.g. "stories/my-script-123.json"
      beatIndex: number;
    };

    if (!filePath || beatIndex === undefined) {
      res.status(400).json({ error: "filePath and beatIndex are required" });
      return;
    }

    const absoluteFilePath = path.join(workspacePath, filePath);
    if (!fs.existsSync(absoluteFilePath)) {
      res.status(404).json({ error: `File not found: ${filePath}` });
      return;
    }

    try {
      setGraphAILogger(false);

      const files = getFileObject({
        file: absoluteFilePath,
        basedir: path.dirname(absoluteFilePath),
        grouped: true,
      });

      const context = await initializeContextFromFiles(files, true);
      if (!context) {
        res.status(500).json({ error: "Failed to initialize mulmo context" });
        return;
      }

      await generateBeatImage({ index: beatIndex, context });

      const { imagePath } = getBeatPngImagePath(context, beatIndex);

      if (!fs.existsSync(imagePath)) {
        res.status(500).json({ error: "Image was not generated" });
        return;
      }

      const imageData = fs.readFileSync(imagePath);
      const base64 = imageData.toString("base64");

      res.json({ image: `data:image/png;base64,${base64}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  },
);

export default router;
