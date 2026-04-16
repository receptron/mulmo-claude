import { access, appendFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { Router, Request, Response } from "express";
import { getRole } from "../roles.js";
import { runAgent } from "../agent.js";
import { prependJournalPointer } from "../agent/prompt.js";
import {
  getOrCreateSession,
  beginRun,
  endRun,
  cancelRun,
  pushSessionEvent,
  pushToolResult,
  getActiveSessionIds,
} from "../session-store/index.js";
import { workspacePath } from "../workspace.js";
import { WORKSPACE_PATHS } from "../workspace-paths.js";
import { maybeRunJournal } from "../journal/index.js";
import { maybeIndexSession } from "../chat-index/index.js";
import { maybeAppendWikiBacklinks } from "../wiki-backlinks/index.js";
import { log } from "../logger/index.js";
import { logBackgroundError } from "../utils/logBackgroundError.js";
import { createArgsCache, recordToolEvent } from "../tool-trace/index.js";
import { API_ROUTES } from "../../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../../src/types/events.js";
import { env } from "../env.js";

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
}

export type StartChatResult =
  | { kind: "started"; chatSessionId: string }
  | { kind: "error"; error: string; status?: number };

export async function startChat(
  params: StartChatParams,
): Promise<StartChatResult> {
  const { message, roleId, chatSessionId, selectedImageData } = params;

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
    await writeFile(
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
  });

  return { kind: "started", chatSessionId };
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
  } = params;

  try {
    for await (const event of runAgent(
      decoratedMessage,
      role,
      workspacePath,
      chatSessionId,
      PORT,
      claudeSessionId,
      abortSignal,
    )) {
      if (event.type === EVENT_TYPES.claudeSessionId) {
        await updateClaudeSessionId(metaFilePath, event.id);
        continue;
      }
      pushSessionEvent(chatSessionId, event as Record<string, unknown>);

      if (event.type === EVENT_TYPES.text) {
        await appendFile(
          resultsFilePath,
          JSON.stringify({
            source: "assistant",
            type: EVENT_TYPES.text,
            message: event.message,
          }) + "\n",
        );
      }
      if (event.type === EVENT_TYPES.toolCall) {
        log.info("agent-tool", "call", {
          chatSessionId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          argsPreview: previewJson(event.args),
        });
      }
      if (event.type === EVENT_TYPES.toolCallResult) {
        // Look up the toolName from the cache *before* recordToolEvent
        // runs (it deletes the cache entry on result).
        const cached = toolArgsCache.get(event.toolUseId);
        log.info("agent-tool", "result", {
          chatSessionId,
          toolName: cached?.toolName,
          toolUseId: event.toolUseId,
          contentBytes: event.content.length,
        });
      }
      if (
        event.type === EVENT_TYPES.toolCall ||
        event.type === EVENT_TYPES.toolCallResult
      ) {
        // Fire-and-forget: tool-trace persistence failures must not
        // block the agent loop. Errors are log.warn'd by
        // recordToolEvent itself.
        recordToolEvent(event, {
          workspaceRoot: workspacePath,
          chatSessionId,
          resultsFilePath,
          argsCache: toolArgsCache,
        }).catch(logBackgroundError("tool-trace"));
      }
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
      await writeFile(
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
    await writeFile(metaFilePath, JSON.stringify({ ...meta, claudeSessionId }));
  } catch {
    // ignore if meta file is missing
  }
}

export default router;
