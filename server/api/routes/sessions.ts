import { Router, Request, Response } from "express";
import { realpathSync } from "fs";
import { readdir, stat } from "fs/promises";
import { readTextSafe } from "../../utils/files/safe.js";
import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { readSessionMeta as readSessionMetaIO, readSessionJsonl, sessionJsonlAbsPath, sessionMetaAbsPath } from "../../utils/files/session-io.js";
import { readManifest } from "../../workspace/chat-index/indexer.js";
import { resolveWithinRoot } from "../../utils/files/safe.js";
import type { ChatIndexEntry } from "../../workspace/chat-index/types.js";
import { markRead, getSession } from "../../events/session-store/index.js";
import { notFound } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import type { SessionOrigin } from "../../../src/types/session.js";
import { env } from "../../system/env.js";
import { ONE_DAY_MS } from "../../utils/time.js";
import { encodeCursor, parseCursor, sessionChangeMs } from "./sessionsCursor.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

interface SessionMeta {
  roleId: string;
  startedAt: string;
  firstUserMessage?: string;
  hasUnread?: boolean;
  origin?: SessionOrigin;
}

async function readSessionMeta(__chatDir: string, sessionId: string): Promise<SessionMeta | null> {
  // Try new-style .json meta first
  const meta = await readSessionMetaIO(sessionId);
  if (meta?.roleId && meta?.startedAt) {
    return meta as SessionMeta;
  }
  // Legacy: read first line of .jsonl
  const jsonl = await readSessionJsonl(sessionId);
  if (jsonl) {
    const first = jsonl.split("\n").find(Boolean);
    if (first) {
      try {
        const parsed = JSON.parse(first);
        if (parsed.roleId && parsed.startedAt) return parsed;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export interface SessionSummary {
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
  // Where this session originated (#486). Missing = "human".
  origin?: SessionOrigin;
  // Live state from the in-memory session store. Absent when the
  // session has no active entry in the store (i.e. idle / historical).
  isRunning?: boolean;
  hasUnread?: boolean;
  statusMessage?: string;
}

// Public response envelope for GET /api/sessions (issue #205).
//
// `cursor`     — opaque string clients echo back as `?since=` on the
//                next call to receive only sessions that have changed.
// `deletedIds` — always `[]` for now (no session-delete code path
//                exists yet). Kept in the shape so the client already
//                merges it; when deletion lands, populating this will
//                be a server-only change.
interface SessionsResponse {
  sessions: SessionSummary[];
  cursor: string;
  deletedIds: string[];
}

interface SessionsQuery {
  since?: string;
}

const router = Router();

// Sessions older than this are excluded from the listing. Set
// SESSIONS_LIST_WINDOW_DAYS to override (0 = no cutoff).
const WINDOW_MS = env.sessionsListWindowDays * ONE_DAY_MS;

// Read the full session list off disk. Each row carries its
// `changeMs` — the later of the jsonl mtime and the chat-index
// `indexedAt` — so the handler can filter against `?since=` and
// compute the new cursor without re-statting anything.
export async function loadAllSessions(): Promise<{ summary: SessionSummary; changeMs: number }[]> {
  const chatDir = WORKSPACE_PATHS.chat;
  const manifest = await readManifest(workspacePath);
  const indexById = new Map<string, ChatIndexEntry>(manifest.entries.map((entry) => [entry.id, entry]));
  const cutoff = WINDOW_MS > 0 ? Date.now() - WINDOW_MS : 0;

  const files = (await readdir(chatDir)).filter((fileName) => fileName.endsWith(".jsonl"));
  const rows = await Promise.all(
    files.map(async (file) => {
      const sessionId = file.replace(".jsonl", "");
      try {
        // stat only — no readFile on .jsonl content
        const fileStat = await stat(sessionJsonlAbsPath(sessionId));
        if (cutoff > 0 && fileStat.mtimeMs < cutoff) return null;

        const meta = await readSessionMeta(chatDir, sessionId);
        if (!meta) return null;

        // The meta sidecar bumps its mtime on hasUnread / origin
        // writes — feed it into changeMs so cursor-based refetches
        // pick up drains of background generations (which only touch
        // meta, not the jsonl). Missing stat (brand-new session
        // before its first meta write) contributes 0.
        const metaMtimeMs = await stat(sessionMetaAbsPath(sessionId))
          .then((stats) => stats.mtimeMs)
          .catch(() => 0);

        const indexEntry = indexById.get(sessionId);
        // Prefer AI title → meta.firstUserMessage → empty.
        // `summary` and `keywords` are spread conditionally
        // to respect the server tsconfig's
        // exactOptionalPropertyTypes.
        const preview = indexEntry?.title ?? meta.firstUserMessage ?? "";

        const live = getSession(sessionId);
        const summary: SessionSummary = {
          id: sessionId,
          roleId: meta.roleId,
          startedAt: meta.startedAt,
          updatedAt: new Date(fileStat.mtimeMs).toISOString(),
          preview,
          hasUnread: live?.hasUnread ?? meta.hasUnread ?? false,
        };
        if (meta.origin) summary.origin = meta.origin;
        if (indexEntry?.summary !== undefined) summary.summary = indexEntry.summary;
        if (indexEntry?.keywords !== undefined) summary.keywords = indexEntry.keywords;
        if (live) {
          // Background generations (image/audio/movie) keep the session
          // "busy" even when the agent turn has ended, so the sidebar
          // indicator stays lit across view navigation.
          summary.isRunning = live.isRunning || Object.keys(live.pendingGenerations).length > 0;
          summary.statusMessage = live.statusMessage;
        }
        return {
          summary,
          changeMs: sessionChangeMs(fileStat.mtimeMs, indexEntry?.indexedAt, metaMtimeMs),
        };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((row): row is { summary: SessionSummary; changeMs: number } => row !== null);
}

router.get(API_ROUTES.sessions.list, async (req: Request<object, SessionsResponse, object, SessionsQuery>, res: Response<SessionsResponse>) => {
  try {
    const sinceMs = parseCursor(req.query.since);
    log.info("sessions", "list: start", { sinceMs: sinceMs > 0 ? sinceMs : undefined });
    const rows = await loadAllSessions();

    // Cursor = max(changeMs) across every visible session, regardless
    // of whether it's in the diff. Echoing the same cursor back on an
    // empty diff (nothing changed since `?since=`) is fine; the
    // client no-ops.
    const maxChangeMs = rows.reduce((acc, row) => Math.max(acc, row.changeMs), 0);

    const filtered = sinceMs > 0 ? rows.filter((row) => row.changeMs > sinceMs) : rows;

    const sessions = filtered.map((row) => row.summary);
    sessions.sort((leftSession, rightSession) => {
      const byUpdated = new Date(rightSession.updatedAt).getTime() - new Date(leftSession.updatedAt).getTime();
      if (byUpdated !== 0) return byUpdated;
      return new Date(rightSession.startedAt).getTime() - new Date(leftSession.startedAt).getTime();
    });

    log.info("sessions", "list: ok", { total: sessions.length, returned: filtered.length });
    res.json({
      sessions,
      cursor: encodeCursor(maxChangeMs),
      // No session-delete code path exists today — issue #205 picked
      // approach A (tombstones) so the client already merges this
      // field; populating it becomes a server-only change when
      // deletion lands.
      deletedIds: [],
    });
  } catch (err) {
    log.error("sessions", "list: threw", { error: errorMessage(err) });
    res.json({ sessions: [], cursor: encodeCursor(0), deletedIds: [] });
  }
});

interface SessionIdParams {
  id: string;
}

interface SessionErrorResponse {
  error: string;
}

router.get(API_ROUTES.sessions.detail, async (req: Request<SessionIdParams>, res: Response<unknown[] | SessionErrorResponse>) => {
  const { id: sessionId } = req.params;
  const chatDir = WORKSPACE_PATHS.chat;
  log.info("sessions", "detail: start", { sessionId });
  try {
    const meta = await readSessionMeta(chatDir, sessionId);
    const content = await readSessionJsonl(sessionId);
    if (!content) {
      log.warn("sessions", "detail: not found", { sessionId });
      notFound(res, `Session ${sessionId} not found`);
      return;
    }
    const entries = (
      await Promise.all(
        content
          .split("\n")
          .filter(Boolean)
          .map(async (line) => {
            try {
              const entry = JSON.parse(line);
              // Skip legacy metadata entries now stored in .json
              if (entry.type === EVENT_TYPES.sessionMeta || entry.type === EVENT_TYPES.claudeSessionId) return null;
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
                    storiesReal = realpathSync(storiesDir);
                  } catch {
                    return entry;
                  }
                  const scriptRelPath: string = entry.result.data.filePath;
                  if (path.isAbsolute(scriptRelPath)) return entry;
                  // Strip optional "stories/" prefix so the
                  // remainder is relative to storiesReal.
                  const relFromStories = scriptRelPath.startsWith("stories/") ? scriptRelPath.slice("stories/".length) : scriptRelPath;
                  const scriptPath = resolveWithinRoot(storiesReal, relFromStories);
                  if (!scriptPath) return entry;
                  const scriptJson = (await readTextSafe(scriptPath)) ?? "";
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
    const result = meta ? [{ type: EVENT_TYPES.sessionMeta, ...meta }, ...entries] : entries;
    log.info("sessions", "detail: ok", { sessionId, entries: result.length });
    res.json(result);
  } catch (err) {
    log.error("sessions", "detail: threw", { sessionId, error: errorMessage(err) });
    notFound(res, "Session not found");
  }
});

// Mark a session as read (clears the hasUnread flag in the session store).
// Awaits persistence so the response only arrives after the disk write
// completes — prevents the client from refetching stale hasUnread values.
router.post(API_ROUTES.sessions.markRead, async (req: Request<SessionIdParams>, res: Response<{ ok: boolean }>) => {
  log.info("sessions", "mark-read: start", { sessionId: req.params.id });
  await markRead(req.params.id);
  log.info("sessions", "mark-read: ok", { sessionId: req.params.id });
  res.json({ ok: true });
});

export default router;
