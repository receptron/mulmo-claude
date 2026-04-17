import { access, appendFile, mkdir, readFile } from "fs/promises";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import path from "path";
import { Router, Request, Response } from "express";
import { getRole } from "../../workspace/roles.js";
import { runAgent } from "../../agent/index.js";
import { prependJournalPointer } from "../../agent/prompt.js";
import {
  buildTranscriptPreamble,
  isStaleSessionError,
} from "../../agent/resumeFailover.js";
import {
  getOrCreateSession,
  beginRun,
  endRun,
  cancelRun,
  pushSessionEvent,
  pushToolResult,
  getActiveSessionIds,
} from "../../events/session-store/index.js";
import { workspacePath } from "../../workspace/workspace.js";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { maybeRunJournal } from "../../workspace/journal/index.js";
import { maybeIndexSession } from "../../workspace/chat-index/index.js";
import { maybeAppendWikiBacklinks } from "../../workspace/wiki-backlinks/index.js";
import { log } from "../../system/logger/index.js";
import { logBackgroundError } from "../../utils/logBackgroundError.js";
import {
  createArgsCache,
  recordToolEvent,
} from "../../workspace/tool-trace/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { env } from "../../system/env.js";
import type { Attachment } from "../chat-service/types.js";

const router = Router();
const PORT = env.port;

// Short, safe preview of tool args for logs. Full payload may contain
// base64 images or large blobs, so we cap it. The goal is to make a
// line like `mcp__deepwiki__read_wiki_contents` grep-able in logs
// alongside its args shape, not to record the full input.
const TOOL_ARGS_LOG_PREVIEW_MAX = 200;
function previewJson(value: unknown): string {
  let serialised: string;
  try {
    serialised = JSON.stringify(value);
  } catch {
    return "[unserialisable]";
  }
  if (serialised === undefined) return "";
  return serialised.length > TOOL_ARGS_LOG_PREVIEW_MAX
    ? `${serialised.slice(0, TOOL_ARGS_LOG_PREVIEW_MAX)}…`
    : serialised;
}

// Called by the MCP server to push a ToolResult into the active session.
interface OkResponse {
  ok: boolean;
}

router.post(
  API_ROUTES.agent.internal.toolResult,
  async (
    req: Request<object, unknown, Record<string, unknown>>,
    res: Response<OkResponse>,
  ) => {
    const chatSessionId = String(req.query.session ?? "");
    const outcome = await pushToolResult(chatSessionId, req.body);
    res.json({ ok: outcome.kind === "processed" });
  },
);

// Called by the MCP server to trigger a role switch on the frontend
interface SwitchRoleBody {
  roleId: string;
}

router.post(
  API_ROUTES.agent.internal.switchRole,
  async (
    req: Request<object, unknown, SwitchRoleBody>,
    res: Response<OkResponse>,
  ) => {
    const chatSessionId = String(req.query.session ?? "");
    pushSessionEvent(chatSessionId, {
      type: EVENT_TYPES.switchRole,
      roleId: req.body.roleId,
    });
    res.json({ ok: true });
  },
);

// Cancel a running agent session by killing the Claude CLI process.
interface CancelBody {
  chatSessionId: string;
}

router.post(
  API_ROUTES.agent.cancel,
  (req: Request<object, unknown, CancelBody>, res: Response<OkResponse>) => {
    const { chatSessionId } = req.body;
    if (!chatSessionId) {
      res.json({ ok: false });
      return;
    }
    const ok = cancelRun(chatSessionId);
    res.json({ ok });
  },
);

// ── Internal API: startChat ─────────────────────────────────────────
//
// Shared entry point for starting an agent chat. Called by both the
// POST /api/agent route and server-side callers (e.g. debug tasks).

export interface StartChatParams {
  message: string;
  roleId: string;
  chatSessionId: string;
  selectedImageData?: string;
  attachments?: Attachment[];
}

export type StartChatResult =
  | { kind: "started"; chatSessionId: string }
  | { kind: "error"; error: string; status?: number };

export async function startChat(
  params: StartChatParams,
): Promise<StartChatResult> {
  const { message, roleId, chatSessionId, selectedImageData, attachments } =
    params;

  if (!message || !roleId || !chatSessionId) {
    return {
      kind: "error",
      error: "message, roleId, and chatSessionId are required",
      status: 400,
    };
  }

  const chatDir = WORKSPACE_PATHS.chat;
  await mkdir(chatDir, { recursive: true });
  const resultsFilePath = path.join(chatDir, `${chatSessionId}.jsonl`);
  const metaFilePath = path.join(chatDir, `${chatSessionId}.json`);

  // Check whether this is a brand-new session up front so we can both
  // (a) decide whether to read persisted hasUnread (skipped for first
  // turn — nothing on disk yet) and (b) pick meta-write vs backfill
  // after beginRun succeeds.
  let isFirstTurn = false;
  try {
    await access(metaFilePath);
  } catch {
    isFirstTurn = true;
  }

  // Read persisted hasUnread so the in-memory store starts with the
  // correct value (survives server restarts). Must happen before
  // getOrCreateSession; for the first turn the meta file doesn't
  // exist yet so the value stays undefined.
  let persistedHasUnread: boolean | undefined;
  if (!isFirstTurn) {
    try {
      const meta = JSON.parse(await readFile(metaFilePath, "utf-8"));
      persistedHasUnread = meta.hasUnread === true;
    } catch {
      // ignore — meta file may be missing or malformed
    }
  }

  const now = new Date().toISOString();
  getOrCreateSession(chatSessionId, {
    roleId,
    resultsFilePath,
    selectedImageData,
    startedAt: now,
    updatedAt: now,
    hasUnread: persistedHasUnread,
  });

  // Register abort callback and mark running FIRST. If the session
  // is already running, reject with 409 before we persist anything.
  // Writing the user message to jsonl or broadcasting it before this
  // check leaves an orphan message on disk + in every viewing tab
  // when the run is rejected — see #281.
  const abortController = new AbortController();
  const started = beginRun(chatSessionId, () => abortController.abort());
  if (!started) {
    return { kind: "error", error: "Session is already running", status: 409 };
  }

  // Run is committed. Now persist the user message so callers (and
  // other tabs) see the turn. Metadata first — it powers the sidebar
  // title cache; the append follows so the jsonl is always a
  // superset of what metadata advertised.
  if (isFirstTurn) {
    await writeFileAtomic(
      metaFilePath,
      JSON.stringify({
        roleId,
        startedAt: new Date().toISOString(),
        firstUserMessage: message,
      }),
    );
  } else {
    await backfillFirstUserMessage(metaFilePath, message);
  }

  // Append user message for this turn
  await appendFile(
    resultsFilePath,
    JSON.stringify({ source: "user", type: EVENT_TYPES.text, message }) + "\n",
  );

  // Broadcast the user message so other tabs viewing this session
  // see the input in real time. Runs AFTER beginRun so a 409 never
  // produces a phantom user message in other clients.
  pushSessionEvent(chatSessionId, {
    type: EVENT_TYPES.text,
    source: "user",
    message,
  });

  const role = getRole(roleId);
  const claudeSessionId = await readClaudeSessionId(
    metaFilePath,
    resultsFilePath,
  );

  const requestStartedAt = Date.now();
  log.info("agent", "request received", {
    chatSessionId,
    roleId,
    messageLen: message.length,
    resumed: Boolean(claudeSessionId),
  });

  const decoratedMessage = claudeSessionId
    ? message
    : prependJournalPointer(message, workspacePath);

  runAgentInBackground({
    decoratedMessage,
    role,
    chatSessionId,
    claudeSessionId,
    abortSignal: abortController.signal,
    resultsFilePath,
    metaFilePath,
    requestStartedAt,
    toolArgsCache: createArgsCache(),
    attachments: mergeAttachments(selectedImageData, attachments),
  });

  return { kind: "started", chatSessionId };
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert legacy `selectedImageData` (data URL from the Vue UI) into
 *  the generic Attachment format, then merge with any explicitly-
 *  provided attachments from the bridge protocol. Returns undefined
 *  when there's nothing to attach. */
function mergeAttachments(
  selectedImageData: string | undefined,
  explicit: Attachment[] | undefined,
): Attachment[] | undefined {
  const result: Attachment[] = [];
  if (selectedImageData) {
    const match = selectedImageData.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      result.push({ mimeType: match[1], data: match[2] });
    }
  }
  if (explicit) {
    result.push(...explicit);
  }
  return result.length > 0 ? result : undefined;
}

// ── HTTP route ──────────────────────────────────────────────────────

interface AgentBody {
  message: string;
  roleId: string;
  chatSessionId: string;
  selectedImageData?: string;
}

interface ErrorResponse {
  error: string;
}

interface AcceptedResponse {
  chatSessionId: string;
}

router.post(
  API_ROUTES.agent.run,
  async (
    req: Request<object, unknown, AgentBody>,
    res: Response<ErrorResponse | AcceptedResponse>,
  ) => {
    const result = await startChat(req.body);
    if (result.kind === "error") {
      res.status(result.status ?? 500).json({ error: result.error });
      return;
    }
    res.status(202).json({ chatSessionId: result.chatSessionId });
  },
);

// Runs the agent loop as a detached async task. Events are published
// to the session's pub/sub channel. When the loop ends, `endRun` is
// called to mark the session as finished and publish `session_finished`.
interface BackgroundRunParams {
  decoratedMessage: string;
  role: ReturnType<typeof getRole>;
  chatSessionId: string;
  claudeSessionId: string | undefined;
  abortSignal: AbortSignal;
  resultsFilePath: string;
  metaFilePath: string;
  requestStartedAt: number;
  toolArgsCache: ReturnType<typeof createArgsCache>;
  attachments: Attachment[] | undefined;
}

// Per-event side-effect context passed to `handleAgentEvent`.
interface EventContext {
  chatSessionId: string;
  resultsFilePath: string;
  metaFilePath: string;
  toolArgsCache: ReturnType<typeof createArgsCache>;
}

// Returns true if the event was handled "out of band" (no pub-sub
// broadcast, no jsonl append). Right now only `claudeSessionId`
// events fall into that bucket — they update meta and are otherwise
// invisible to clients. Everything else is treated as "normal flow":
// broadcast + optional jsonl append + optional tool-trace side effect.
async function handleAgentEvent(
  event: Awaited<ReturnType<typeof runAgent>> extends AsyncGenerator<infer E>
    ? E
    : never,
  ctx: EventContext,
): Promise<void> {
  if (event.type === EVENT_TYPES.claudeSessionId) {
    await updateClaudeSessionId(ctx.metaFilePath, event.id);
    return;
  }
  pushSessionEvent(ctx.chatSessionId, event as Record<string, unknown>);

  if (event.type === EVENT_TYPES.text) {
    await appendFile(
      ctx.resultsFilePath,
      JSON.stringify({
        source: "assistant",
        type: EVENT_TYPES.text,
        message: event.message,
      }) + "\n",
    );
    return;
  }
  if (event.type === EVENT_TYPES.toolCall) {
    log.info("agent-tool", "call", {
      chatSessionId: ctx.chatSessionId,
      toolName: event.toolName,
      toolUseId: event.toolUseId,
      argsPreview: previewJson(event.args),
    });
  } else if (event.type === EVENT_TYPES.toolCallResult) {
    // Look up the toolName from the cache *before* recordToolEvent
    // runs (it deletes the cache entry on result).
    const cached = ctx.toolArgsCache.get(event.toolUseId);
    log.info("agent-tool", "result", {
      chatSessionId: ctx.chatSessionId,
      toolName: cached?.toolName,
      toolUseId: event.toolUseId,
      contentBytes: event.content.length,
    });
  } else {
    return;
  }
  // Fire-and-forget: tool-trace persistence failures must not block
  // the agent loop. Errors are log.warn'd by recordToolEvent itself.
  recordToolEvent(event, {
    workspaceRoot: workspacePath,
    chatSessionId: ctx.chatSessionId,
    resultsFilePath: ctx.resultsFilePath,
    argsCache: ctx.toolArgsCache,
  }).catch(logBackgroundError("tool-trace"));
}

async function runAgentInBackground(
  params: BackgroundRunParams,
): Promise<void> {
  const {
    decoratedMessage,
    role,
    chatSessionId,
    claudeSessionId,
    abortSignal,
    resultsFilePath,
    metaFilePath,
    requestStartedAt,
    toolArgsCache,
    attachments,
  } = params;

  const eventCtx: EventContext = {
    chatSessionId,
    resultsFilePath,
    metaFilePath,
    toolArgsCache,
  };

  // Retry budget for the stale `--resume` id fail-over (#211). Only
  // meaningful when we entered with a `claudeSessionId`; a fresh
  // session can't hit that error. One retry max so a looping CLI
  // bug can't stack infinite replays of the transcript.
  let failoverAttemptsRemaining = claudeSessionId ? 1 : 0;
  let currentMessage = decoratedMessage;
  let currentClaudeSessionId = claudeSessionId;

  try {
    while (true) {
      let staleSessionDetected = false;
      for await (const event of runAgent(
        currentMessage,
        role,
        workspacePath,
        chatSessionId,
        PORT,
        currentClaudeSessionId,
        abortSignal,
        attachments,
      )) {
        if (
          failoverAttemptsRemaining > 0 &&
          event.type === EVENT_TYPES.error &&
          typeof event.message === "string" &&
          isStaleSessionError(event.message)
        ) {
          // Swallow the error — we're about to recover. `break`
          // abandons the current generator; since the event is only
          // yielded after the CLI has already exited non-zero, the
          // subprocess is dead by this point and there's nothing to
          // clean up beyond what `for await`'s return() already does.
          staleSessionDetected = true;
          failoverAttemptsRemaining--;
          break;
        }
        await handleAgentEvent(event, eventCtx);
      }
      if (!staleSessionDetected) break;

      // Stale `--resume` recovery: clear the bad id from meta so the
      // next *external* read of this session doesn't see it, build a
      // natural-language preamble from the jsonl we already have,
      // and loop back to `runAgent` without `--resume`. Surface a
      // status event so the UI pause doesn't look like a hang.
      log.warn("agent", "stale claude session id — retrying without --resume", {
        chatSessionId,
      });
      await clearClaudeSessionId(metaFilePath);
      const preamble = await readTranscriptPreamble(resultsFilePath);
      currentMessage = preamble
        ? `${preamble}${decoratedMessage}`
        : decoratedMessage;
      currentClaudeSessionId = undefined;
      pushSessionEvent(chatSessionId, {
        type: EVENT_TYPES.status,
        message:
          "Previous session unavailable — continuing with local transcript.",
      });
    }
    log.info("agent", "request completed", {
      chatSessionId,
      durationMs: Date.now() - requestStartedAt,
    });
  } catch (err) {
    log.error("agent", "request failed", {
      chatSessionId,
      error: String(err),
    });
    pushSessionEvent(chatSessionId, {
      type: EVENT_TYPES.error,
      message: String(err),
    });
  } finally {
    endRun(chatSessionId);
    // Fire-and-forget: journal + chat-index post-processing
    maybeRunJournal({ activeSessionIds: getActiveSessionIds() }).catch(
      logBackgroundError("journal"),
    );
    maybeIndexSession({
      sessionId: chatSessionId,
      activeSessionIds: getActiveSessionIds(),
    }).catch(logBackgroundError("chat-index"));
    // Walks wiki/pages/ for files modified during this turn and
    // appends a backlink to the originating chat session so the
    // user can jump back from a wiki page to the conversation
    // that created it. See #109.
    maybeAppendWikiBacklinks({
      chatSessionId,
      turnStartedAt: requestStartedAt,
    }).catch(logBackgroundError("wiki-backlinks"));
  }
}

async function readClaudeSessionId(
  metaFilePath: string,
  jsonlFilePath: string,
): Promise<string | undefined> {
  try {
    const meta = JSON.parse(await readFile(metaFilePath, "utf-8"));
    if (meta.claudeSessionId) return meta.claudeSessionId;
  } catch {
    // fall through to legacy scan
  }
  try {
    const lines = (await readFile(jsonlFilePath, "utf-8"))
      .split("\n")
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === EVENT_TYPES.claudeSessionId && entry.id)
          return entry.id;
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file doesn't exist yet
  }
  return undefined;
}

/** Add firstUserMessage to an existing meta file if it's missing (migration). */
async function backfillFirstUserMessage(
  metaFilePath: string,
  message: string,
): Promise<void> {
  try {
    const meta = JSON.parse(await readFile(metaFilePath, "utf-8"));
    if (!meta.firstUserMessage) {
      await writeFileAtomic(
        metaFilePath,
        JSON.stringify({ ...meta, firstUserMessage: message }),
      );
    }
  } catch {
    // ignore — meta file may not exist
  }
}

async function updateClaudeSessionId(
  metaFilePath: string,
  claudeSessionId: string,
): Promise<void> {
  try {
    const meta = JSON.parse(await readFile(metaFilePath, "utf-8"));
    await writeFileAtomic(
      metaFilePath,
      JSON.stringify({ ...meta, claudeSessionId }),
    );
  } catch {
    // ignore if meta file is missing
  }
}

// Drop the (now-stale) `claudeSessionId` key from meta after a
// `--resume` fail-over. Leaves every other field (roleId, startedAt,
// firstUserMessage, hasUnread) intact. The new id gets written back
// by `updateClaudeSessionId` on the retried run's first
// `claudeSessionId` event.
async function clearClaudeSessionId(metaFilePath: string): Promise<void> {
  try {
    const meta = JSON.parse(await readFile(metaFilePath, "utf-8"));
    delete meta.claudeSessionId;
    await writeFileAtomic(metaFilePath, JSON.stringify(meta));
  } catch {
    // ignore if meta file is missing or unreadable
  }
}

// Read the session jsonl and render the transcript preamble used on
// `--resume` fail-over. Returns "" on any read / parse failure —
// the retry then runs without a preamble, which is still an
// improvement over the user seeing the original error.
async function readTranscriptPreamble(
  resultsFilePath: string,
): Promise<string> {
  try {
    const jsonl = await readFile(resultsFilePath, "utf-8");
    return buildTranscriptPreamble(jsonl);
  } catch {
    return "";
  }
}

export default router;
