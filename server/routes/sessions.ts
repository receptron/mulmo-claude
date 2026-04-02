import { Router, Request, Response } from "express";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { workspacePath } from "../workspace.js";

async function readSessionMeta(
  chatDir: string,
  id: string,
): Promise<{ roleId: string; startedAt: string } | null> {
  // Try new-style .json file first
  try {
    const meta = JSON.parse(
      await readFile(path.join(chatDir, `${id}.json`), "utf-8"),
    );
    if (meta.roleId && meta.startedAt) return meta;
  } catch {
    // fall through
  }
  // Legacy: read first line of .jsonl
  try {
    const first = (await readFile(path.join(chatDir, `${id}.jsonl`), "utf-8"))
      .split("\n")
      .find(Boolean);
    if (first) {
      const meta = JSON.parse(first);
      if (meta.roleId && meta.startedAt) return meta;
    }
  } catch {
    // ignore
  }
  return null;
}

interface SessionEntry {
  source?: string;
  message?: string;
}

interface SessionSummary {
  id: string;
  roleId: string;
  startedAt: string;
  preview: string;
}

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
            const meta = await readSessionMeta(chatDir, id);
            if (!meta) return null;
            const content = await readFile(path.join(chatDir, file), "utf-8");
            const firstUserLine: SessionEntry | undefined = content
              .split("\n")
              .filter(Boolean)
              .map((l): SessionEntry | null => {
                try {
                  return JSON.parse(l);
                } catch {
                  return null;
                }
              })
              .find((e): e is SessionEntry => e?.source === "user");
            return {
              id,
              roleId: meta.roleId,
              startedAt: meta.startedAt,
              preview: firstUserLine?.message ?? "",
            };
          } catch {
            return null;
          }
        }),
      )
    ).filter((s): s is SessionSummary => s !== null);

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
  const id = String(req.params.id);
  const chatDir = path.join(workspacePath, "chat");
  const filePath = path.join(chatDir, `${id}.jsonl`);
  try {
    const meta = await readSessionMeta(chatDir, id);
    const content = await readFile(filePath, "utf-8");
    const entries = (
      await Promise.all(
        content
          .split("\n")
          .filter(Boolean)
          .map(async (line) => {
            try {
              const entry = JSON.parse(line);
              // Skip legacy metadata entries now stored in .json
              if (
                entry.type === "session_meta" ||
                entry.type === "claude_session_id"
              )
                return null;
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
    // Prepend metadata as session_meta entry for the frontend
    const result = meta
      ? [{ type: "session_meta", ...meta }, ...entries]
      : entries;
    res.json(result);
  } catch {
    res.status(404).json({ error: "Session not found" });
  }
});

export default router;
