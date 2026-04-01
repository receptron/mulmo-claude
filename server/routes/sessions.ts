import { Router, Request, Response } from "express";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { workspacePath } from "../workspace.js";

const router = Router();

router.get("/sessions", async (_req: Request, res: Response) => {
  const chatDir = path.join(workspacePath, "chat");
  try {
    const files = (await readdir(chatDir)).filter((f) => f.endsWith(".jsonl"));
    const sessions = (
      await Promise.all(
        files.map(async (file) => {
          const id = file.replace(".jsonl", "");
          try {
            const content = await readFile(path.join(chatDir, file), "utf-8");
            const lines = content.split("\n").filter(Boolean);
            const meta = JSON.parse(lines[0]);
            const firstUserLine = lines
              .slice(1)
              .map((l) => {
                try {
                  return JSON.parse(l);
                } catch {
                  return null;
                }
              })
              .find((e) => e?.source === "user");
            return {
              id,
              roleId: meta.roleId as string,
              startedAt: meta.startedAt as string,
              preview: (firstUserLine?.message as string) ?? "",
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean) as {
      id: string;
      roleId: string;
      startedAt: string;
      preview: string;
    }[];

    sessions.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    res.json(sessions);
  } catch {
    res.json([]);
  }
});

router.get("/sessions/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const filePath = path.join(workspacePath, "chat", `${id}.jsonl`);
  try {
    const content = await readFile(filePath, "utf-8");
    const entries = (
      await Promise.all(
        content
          .split("\n")
          .filter(Boolean)
          .map(async (line) => {
            try {
              const entry = JSON.parse(line);
              // For presentMulmoScript results, re-read the script from disk
              if (
                entry.source === "tool" &&
                entry.type === "tool_result" &&
                entry.result?.toolName === "presentMulmoScript" &&
                entry.result?.data?.filePath
              ) {
                try {
                  const storiesDir = path.resolve(workspacePath, "stories");
                  const scriptPath = path.resolve(
                    workspacePath,
                    entry.result.data.filePath,
                  );
                  if (!scriptPath.startsWith(storiesDir + path.sep)) {
                    return entry;
                  }
                  const scriptJson = await readFile(scriptPath, "utf-8");
                  return {
                    ...entry,
                    result: {
                      ...entry.result,
                      data: {
                        ...entry.result.data,
                        script: JSON.parse(scriptJson),
                      },
                    },
                  };
                } catch {
                  // file missing — return original entry
                }
              }
              return entry;
            } catch {
              return null;
            }
          }),
      )
    ).filter(Boolean);
    res.json(entries);
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

export default router;
