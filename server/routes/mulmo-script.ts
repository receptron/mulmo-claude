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
  type MulmoScript,
} from "mulmocast";
import type { MulmoBeat } from "@mulmocast/types";

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

interface SaveMulmoScriptBody {
  script: MulmoScript;
  filename?: string;
}

interface RenderBeatBody {
  filePath: string;
  beatIndex: number;
}

interface UpdateBeatBody {
  filePath: string;
  beatIndex: number;
  beat: MulmoBeat;
}

router.post(
  "/mulmo-script",
  (req: Request<object, object, SaveMulmoScriptBody>, res: Response) => {
    const { script, filename } = req.body;

    if (!script || !Array.isArray(script.beats)) {
      res.status(400).json({ error: "script with beats array is required" });
      return;
    }

    const storiesDir = path.join(workspacePath, "stories");
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

    const storiesDir = path.resolve(workspacePath, "stories");
    const absoluteFilePath = path.resolve(workspacePath, filePath);
    if (!absoluteFilePath.startsWith(storiesDir + path.sep)) {
      res.status(400).json({ error: "Invalid filePath" });
      return;
    }
    if (!fs.existsSync(absoluteFilePath)) {
      res.status(404).json({ error: `File not found: ${filePath}` });
      return;
    }

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

router.post(
  "/mulmo-script/render-beat",
  async (req: Request<object, object, RenderBeatBody>, res: Response) => {
    const { filePath, beatIndex } = req.body;

    if (!filePath || beatIndex === undefined) {
      res.status(400).json({ error: "filePath and beatIndex are required" });
      return;
    }

    const storiesDir = path.resolve(workspacePath, "stories");
    const absoluteFilePath = path.resolve(workspacePath, filePath);
    if (!absoluteFilePath.startsWith(storiesDir + path.sep)) {
      res.status(400).json({ error: "Invalid filePath" });
      return;
    }
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
