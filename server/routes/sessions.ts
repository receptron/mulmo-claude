import { Router, Request, Response } from "express";
import fs from "fs";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { workspacePath } from "../workspace.js";
import { WORKSPACE_PATHS } from "../workspace-paths.js";
import { readManifest } from "../chat-index/indexer.js";
import { resolveWithinRoot } from "../utils/fs.js";
import type { ChatIndexEntry } from "../chat-index/types.js";
import { markRead, getSession } from "../session-store/index.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../../src/types/events.js";
import { env } from "../env.js";

interface SessionMeta {
  roleId: string;
  startedAt: string;
  firstUserMessage?: string;
  hasUnread?: boolean;
}

async function readSessionMeta(
  chatDir: string,
  id: string,
): Promise<SessionMeta | null> {
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

interface SessionSummary {
  id: string;
  roleId: string;
  startedAt: string;
  // ISO timestamp of the jsonl file's most recent mtime — i.e. the
  // last time the session had an event appended. Clients sort the
  // sidebar history list by this so active sessions float to the top.
  updatedAt: string;
  preview: string;
  // Populated when the chat indexer has produced a summary for this
  // session. The frontend renders `summary` as a smaller second line
  // under the preview in the history popup. See #123.
  summary?: string;
  keywords?: string[];
  // Live state from the in-memory session store. Absent when the
  // session has no active entry in the store (i.e. idle / historical).
  isRunning?: boolean;
  hasUnread?: boolean;
  statusMessage?: string;
}

const router = Router();

// Sessions older than this are excluded from the listing. Set
// SESSIONS_LIST_WINDOW_DAYS to override (0 = no cutoff).
const WINDOW_MS = env.sessionsListWindowDays * 86_400_000;

router.get(
  API_ROUTES.sessions.list,
  async (_req: Request, res: Response<SessionSummary[]>) => {
    const chatDir = WORKSPACE_PATHS.chat;
    const manifest = await readManifest(workspacePath);
    const indexById = new Map<string, ChatIndexEntry>(
      manifest.entries.map((e) => [e.id, e]),
    );
    const cutoff = WINDOW_MS > 0 ? Date.now() - WINDOW_MS : 0;
    try {
      const files = (await readdir(chatDir)).filter((f) =>
        f.endsWith(".jsonl"),
      );
      const sessions = (
        await Promise.all(
          files.map(async (file) => {
            const id = file.replace(".jsonl", "");
            try {
              // stat only — no readFile on .jsonl content
              const fileStat = await stat(path.join(chatDir, file));
              if (cutoff > 0 && fileStat.mtimeMs < cutoff) return null;

              const meta = await readSessionMeta(chatDir, id);
              if (!meta) return null;

              const indexEntry = indexById.get(id);
              // Prefer AI title → meta.firstUserMessage → empty.
              // `summary` and `keywords` are spread conditionally
              // to respect the server tsconfig's
              // exactOptionalPropertyTypes.
              const preview = indexEntry?.title ?? meta.firstUserMessage ?? "";

              const live = getSession(id);
              const summary: SessionSummary = {
                id,
                roleId: meta.roleId,
                startedAt: meta.startedAt,
                updatedAt: new Date(fileStat.mtimeMs).toISOString(),
                preview,
                hasUnread: live?.hasUnread ?? meta.hasUnread ?? false,
              };
              if (indexEntry?.summary !== undefined)
                summary.summary = indexEntry.summary;
              if (indexEntry?.keywords !== undefined)
                summary.keywords = indexEntry.keywords;
              if (live) {
                summary.isRunning = live.isRunning;
                summary.statusMessage = live.statusMessage;
              }
              return summary;
            } catch {
              return null;
            }
          }),
        )
      ).filter((s): s is SessionSummary => s !== null);

      sessions.sort((a, b) => {
        const byUpdated =
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        if (byUpdated !== 0) return byUpdated;
        return (
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        );
      });
      res.json(sessions);
    } catch {
      res.json([]);
    }
  },
);

interface SessionIdParams {
  id: string;
}

interface SessionErrorResponse {
  error: string;
}

router.get(
  API_ROUTES.sessions.detail,
  async (
    req: Request<SessionIdParams>,
    res: Response<unknown[] | SessionErrorResponse>,
  ) => {
    const { id } = req.params;
    const chatDir = WORKSPACE_PATHS.chat;
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
                  entry.type === EVENT_TYPES.sessionMeta ||
                  entry.type === EVENT_TYPES.claudeSessionId
                )
                  return null;
                // For presentMulmoScript results, re-read the script from disk
                if (
                  entry.source === "tool" &&
                  entry.type === EVENT_TYPES.toolResult &&
                  entry.result?.toolName === "presentMulmoScript" &&
                  entry.result?.data?.filePath
                ) {
                  try {
                    // Realpath-based traversal check defeats symlink
                    // escapes — see resolveWithinRoot in utils/fs.ts.
                    // Resolve the stories dir's realpath so the
                    // boundary check works even when stories/ itself
                    // is a legitimate symlink to another disk.
                    const storiesDir = path.resolve(WORKSPACE_PATHS.stories);
                    let storiesReal: string;
                    try {
                      storiesReal = fs.realpathSync(storiesDir);
                    } catch {
                      return entry;
                    }
                    const scriptRelPath: string = entry.result.data.filePath;
                    if (path.isAbsolute(scriptRelPath)) return entry;
                    // Strip optional "stories/" prefix so the
                    // remainder is relative to storiesReal.
                    const relFromStories = scriptRelPath.startsWith("stories/")
                      ? scriptRelPath.slice("stories/".length)
                      : scriptRelPath;
                    const scriptPath = resolveWithinRoot(
                      storiesReal,
                      relFromStories,
                    );
                    if (!scriptPath) return entry;
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
        ? [{ type: EVENT_TYPES.sessionMeta, ...meta }, ...entries]
        : entries;
      res.json(result);
    } catch {
      res.status(404).json({ error: "Session not found" });
    }
  },
);

// Mark a session as read (clears the hasUnread flag in the session store).
router.post(
  API_ROUTES.sessions.markRead,
  (req: Request<SessionIdParams>, res: Response<{ ok: boolean }>) => {
    const ok = markRead(req.params.id);
    res.json({ ok });
  },
);

export default router;
