import { Router, Request, Response } from "express";
import { realpathSync } from "fs";
import { readdir, stat } from "fs/promises";
import { readTextSafe, resolveWithinRoot } from "../../utils/files/safe.js";
import path from "path";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import {
  readSessionMeta as readSessionMetaIO,
  readSessionJsonl,
  sessionJsonlAbsPath,
  sessionMetaAbsPath,
  updateIsBookmarked,
  deleteSessionFiles,
} from "../../utils/files/session-io.js";
import { readManifest, removeSessionFromIndex } from "../../workspace/chat-index/indexer.js";
import type { ChatIndexEntry } from "../../workspace/chat-index/types.js";
import { markRead, getSession, evictSession, publishSessionsChanged } from "../../events/session-store/index.js";
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
  isBookmarked?: boolean;
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
  // User-toggled bookmark — surfaced in the history panel as a
  // dedicated filter chip and a green role-icon tint.
  isBookmarked?: boolean;
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

interface SessionRowContext {
  chatDir: string;
  cutoff: number;
  indexById: Map<string, ChatIndexEntry>;
}

interface SessionRow {
  summary: SessionSummary;
  changeMs: number;
}

// Build a SessionSummary from the gathered inputs. Conditional spreads
// honour the server tsconfig's `exactOptionalPropertyTypes`; that's
// why each optional field is set with `if (… !== undefined)` rather
// than spread into the object literal directly.
function buildSessionSummary(
  sessionId: string,
  meta: SessionMeta,
  indexEntry: ChatIndexEntry | undefined,
  fileStat: { mtimeMs: number },
  live: ReturnType<typeof getSession>,
): SessionSummary {
  // Prefer AI title → meta.firstUserMessage → empty.
  const preview = indexEntry?.title ?? meta.firstUserMessage ?? "";
  const summary: SessionSummary = {
    id: sessionId,
    roleId: meta.roleId,
    startedAt: meta.startedAt,
    updatedAt: new Date(fileStat.mtimeMs).toISOString(),
    preview,
    hasUnread: live?.hasUnread ?? meta.hasUnread ?? false,
  };
  if (meta.origin) summary.origin = meta.origin;
  if (meta.isBookmarked) summary.isBookmarked = true;
  if (indexEntry?.summary !== undefined) summary.summary = indexEntry.summary;
  if (indexEntry?.keywords !== undefined) summary.keywords = indexEntry.keywords;
  if (live) {
    // Background generations (image/audio/movie) keep the session
    // "busy" even when the agent turn has ended, so the sidebar
    // indicator stays lit across view navigation.
    summary.isRunning = live.isRunning || Object.keys(live.pendingGenerations).length > 0;
    summary.statusMessage = live.statusMessage;
  }
  return summary;
}

// Load one session's row, or null when the session should be skipped
// (cutoff window, missing meta, any I/O error). The `metaMtimeMs`
// fallback lets a brand-new session contribute 0 to its changeMs
// instead of crashing the whole listing.
async function loadSessionRow(sessionId: string, ctx: SessionRowContext): Promise<SessionRow | null> {
  try {
    // stat only — no readFile on .jsonl content
    const fileStat = await stat(sessionJsonlAbsPath(sessionId));
    if (ctx.cutoff > 0 && fileStat.mtimeMs < ctx.cutoff) return null;

    const meta = await readSessionMeta(ctx.chatDir, sessionId);
    if (!meta) return null;

    // The meta sidecar bumps its mtime on hasUnread / origin writes —
    // feed it into changeMs so cursor-based refetches pick up drains
    // of background generations (which only touch meta, not the
    // jsonl).
    const metaMtimeMs = await stat(sessionMetaAbsPath(sessionId))
      .then((stats) => stats.mtimeMs)
      .catch(() => 0);

    const indexEntry = ctx.indexById.get(sessionId);
    const live = getSession(sessionId);
    return {
      summary: buildSessionSummary(sessionId, meta, indexEntry, fileStat, live),
      changeMs: sessionChangeMs(fileStat.mtimeMs, indexEntry?.indexedAt, metaMtimeMs),
    };
  } catch {
    return null;
  }
}

// Read the full session list off disk. Each row carries its
// `changeMs` — the later of the jsonl mtime and the chat-index
// `indexedAt` — so the handler can filter against `?since=` and
// compute the new cursor without re-statting anything.
export async function loadAllSessions(): Promise<SessionRow[]> {
  const chatDir = WORKSPACE_PATHS.chat;
  const manifest = await readManifest(workspacePath);
  const indexById = new Map<string, ChatIndexEntry>(manifest.entries.map((entry) => [entry.id, entry]));
  const cutoff = WINDOW_MS > 0 ? Date.now() - WINDOW_MS : 0;
  const ctx: SessionRowContext = { chatDir, cutoff, indexById };

  const files = (await readdir(chatDir)).filter((fileName) => fileName.endsWith(".jsonl"));
  const rows = await Promise.all(files.map((file) => loadSessionRow(file.replace(".jsonl", ""), ctx)));
  return rows.filter((row): row is SessionRow => row !== null);
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

// Narrow type predicate for the presentMulmoScript tool-result shape
// the enrichment helper inspects. Returning `entry is …` lets the
// caller drop the redundant nested checks once the predicate passes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isPresentMulmoScriptToolResult(entry: any): entry is {
  source: "tool";
  type: string;
  result: { toolName: "presentMulmoScript"; data: { filePath: string } & Record<string, unknown> };
} & Record<string, unknown> {
  return (
    entry?.source === "tool" &&
    entry?.type === EVENT_TYPES.toolResult &&
    entry?.result?.toolName === "presentMulmoScript" &&
    typeof entry?.result?.data?.filePath === "string"
  );
}

// Re-read the MulmoScript JSON pointed at by `entry.result.data.filePath`
// and merge it into a copy of the entry. Returns the original entry on
// any failure (missing file, traversal escape, parse error, absolute
// path) so the detail route never breaks because of a single rotted
// link. Path-traversal guard is realpath-based — see
// resolveWithinRoot for why.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichWithMulmoScript(entry: any): Promise<any> {
  try {
    const storiesDir = path.resolve(WORKSPACE_PATHS.stories);
    let storiesReal: string;
    try {
      storiesReal = realpathSync(storiesDir);
    } catch {
      return entry;
    }
    const scriptRelPath: string = entry.result.data.filePath;
    if (path.isAbsolute(scriptRelPath)) return entry;
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
    return entry;
  }
}

// Parse one JSONL line into a session entry, applying the legacy-meta
// skip and the presentMulmoScript enrichment in one place. Returns
// null when the line should not appear in the response (parse error
// or legacy meta).
async function parseSessionEntry(line: string): Promise<unknown> {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  // Skip legacy metadata entries now stored in .json
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const typed = entry as any;
  if (typed?.type === EVENT_TYPES.sessionMeta || typed?.type === EVENT_TYPES.claudeSessionId) return null;
  if (isPresentMulmoScriptToolResult(typed)) return enrichWithMulmoScript(typed);
  return typed;
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
    const entries = (await Promise.all(content.split("\n").filter(Boolean).map(parseSessionEntry))).filter(Boolean);
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

// Toggle the user-set bookmark flag on a session's meta sidecar.
router.post(
  API_ROUTES.sessions.bookmark,
  async (
    req: Request<SessionIdParams, { ok: boolean } | SessionErrorResponse, { bookmarked: boolean }>,
    res: Response<{ ok: boolean } | SessionErrorResponse>,
  ) => {
    const { id: sessionId } = req.params;
    const bookmarked = Boolean(req.body?.bookmarked);
    log.info("sessions", "bookmark: start", { sessionId, bookmarked });
    try {
      await updateIsBookmarked(sessionId, bookmarked);
      // Meta-mtime bumps on the write — cursor diff will pick up the
      // change on the next refetch — but every other tab also needs
      // to know to refetch right now.
      publishSessionsChanged();
      log.info("sessions", "bookmark: ok", { sessionId, bookmarked });
      res.json({ ok: true });
    } catch (err) {
      log.error("sessions", "bookmark: threw", { sessionId, error: errorMessage(err) });
      res.status(500).json({ error: "Failed to update bookmark" });
    }
  },
);

// Hard-delete a session: remove the jsonl, meta sidecar, AND the
// chat-index per-session file + manifest entry, then evict the
// in-memory store entry and broadcast `deletedIds` so every tab
// prunes its caches.
//
// Order matters:
//   1. Refuse if the session is currently running. The agent route
//      (server/api/routes/agent.ts) writes via `appendSessionLine` /
//      `endRun`; deleting the files out from under a live run would
//      either resurrect them or corrupt mid-stream state. Caller
//      should cancel first, then retry the delete.
//   2. Delete the on-disk artifacts (jsonl + meta + index entry +
//      manifest prune). If any of these throw we abort BEFORE
//      evicting / broadcasting, so clients don't see "session gone"
//      while the file lingers.
//   3. Only after disk is clean do we evict from the store and fire
//      `notifySessionsChanged({ deletedIds })`. Now the broadcast is
//      a truthful statement.
router.delete(API_ROUTES.sessions.detail, async (req: Request<SessionIdParams>, res: Response<{ ok: boolean } | SessionErrorResponse>) => {
  const { id: sessionId } = req.params;
  log.info("sessions", "delete: start", { sessionId });
  if (getSession(sessionId)?.isRunning) {
    log.warn("sessions", "delete: refused — session running", { sessionId });
    res.status(409).json({ error: "Session is running. Cancel the run before deleting." });
    return;
  }
  try {
    await deleteSessionFiles(sessionId);
    await removeSessionFromIndex(workspacePath, sessionId);
    evictSession(sessionId);
    log.info("sessions", "delete: ok", { sessionId });
    res.json({ ok: true });
  } catch (err) {
    log.error("sessions", "delete: threw", { sessionId, error: errorMessage(err) });
    res.status(500).json({ error: "Failed to delete session" });
  }
});

export default router;
