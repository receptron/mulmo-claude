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
import { maybeRunJournal } from "../journal/index.js";
import { maybeIndexSession } from "../chat-index/index.js";
import { maybeAppendWikiBacklinks } from "../wiki-backlinks/index.js";
import { log } from "../logger/index.js";
import { createArgsCache, recordToolEvent } from "../tool-trace/index.js";

const router = Router();
const PORT = Number(process.env.PORT) || 3001;

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
  "/internal/tool-result",
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
  "/internal/switch-role",
  async (
    req: Request<object, unknown, SwitchRoleBody>,
    res: Response<OkResponse>,
  ) => {
    const chatSessionId = String(req.query.session ?? "");
    pushSessionEvent(chatSessionId, {
      type: "switch_role",
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
  "/agent/cancel",
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

interface AgentBody {
  message: string;
  roleId: string;
  chatSessionId: string;
  selectedImageData?: string;
  systemPrompt?: string;
  pluginPrompts?: Record<string, string>;
}

interface ErrorResponse {
  error: string;
}

interface AcceptedResponse {
  chatSessionId: string;
}

router.post(
  "/agent",
  async (
    req: Request<object, unknown, AgentBody>,
    res: Response<ErrorResponse | AcceptedResponse>,
  ) => {
    const {
      message,
      roleId,
      chatSessionId,
      selectedImageData,
      systemPrompt,
      pluginPrompts,
    } = req.body;

    if (!message || !roleId || !chatSessionId) {
      res
        .status(400)
        .json({ error: "message, roleId, and chatSessionId are required" });
      return;
    }

    const chatDir = path.join(workspacePath, "chat");
    await mkdir(chatDir, { recursive: true });
    const resultsFilePath = path.join(chatDir, `${chatSessionId}.jsonl`);
    const metaFilePath = path.join(chatDir, `${chatSessionId}.json`);

    // Write or update metadata. On the first message we create the file
    // with firstUserMessage so GET /api/sessions never needs to read the
    // jsonl content. On subsequent turns we backfill firstUserMessage if
    // missing (migrates pre-existing sessions).
    let isFirstTurn = false;
    try {
      await access(metaFilePath);
    } catch {
      isFirstTurn = true;
    }
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
      JSON.stringify({ source: "user", type: "text", message }) + "\n",
    );

    const now = new Date().toISOString();
    getOrCreateSession(chatSessionId, {
      roleId,
      resultsFilePath,
      selectedImageData,
      startedAt: now,
      updatedAt: now,
    });

    // Register abort callback and mark running. If the session is
    // already running, reject with 409 Conflict.
    const abortController = new AbortController();
    const started = beginRun(chatSessionId, () => abortController.abort());
    if (!started) {
      res.status(409).json({ error: "Session is already running" });
      return;
    }

    // Fire-and-forget: return 202 immediately, run agent in background.
    // Events are published to the `session.<chatSessionId>` pub/sub
    // channel — clients subscribe via WebSocket.
    res.status(202).json({ chatSessionId });

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
      pluginPrompts,
      systemPrompt,
      abortSignal: abortController.signal,
      resultsFilePath,
      metaFilePath,
      requestStartedAt,
      // Per-turn cache used by the tool-trace driver to remember args
      // from `tool_call` events so the matching `tool_call_result`
      // can classify properly. Scoped to this request so toolUseIds
      // can't collide across turns.
      toolArgsCache: createArgsCache(),
    });
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
  pluginPrompts: Record<string, string> | undefined;
  systemPrompt: string | undefined;
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
    pluginPrompts,
    systemPrompt,
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
      pluginPrompts,
      systemPrompt,
      abortSignal,
    )) {
      if (event.type === "claude_session_id") {
        await updateClaudeSessionId(metaFilePath, event.id);
        continue;
      }
      pushSessionEvent(chatSessionId, event as Record<string, unknown>);

      if (event.type === "text") {
        await appendFile(
          resultsFilePath,
          JSON.stringify({
            source: "assistant",
            type: "text",
            message: event.message,
          }) + "\n",
        );
      }
      if (event.type === "tool_call") {
        log.info("agent-tool", "call", {
          chatSessionId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          argsPreview: previewJson(event.args),
        });
      }
      if (event.type === "tool_call_result") {
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
      if (event.type === "tool_call" || event.type === "tool_call_result") {
        // Fire-and-forget: tool-trace persistence failures must not
        // block the agent loop. Errors are log.warn'd by
        // recordToolEvent itself.
        recordToolEvent(event, {
          workspaceRoot: workspacePath,
          chatSessionId,
          resultsFilePath,
          argsCache: toolArgsCache,
        }).catch((err) => {
          log.warn("tool-trace", "unexpected error in background", {
            error: String(err),
          });
        });
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
    pushSessionEvent(chatSessionId, { type: "error", message: String(err) });
  } finally {
    endRun(chatSessionId);
    // Fire-and-forget: journal + chat-index post-processing
    maybeRunJournal({ activeSessionIds: getActiveSessionIds() }).catch(
      (err) => {
        log.warn("journal", "unexpected error in background", {
          error: String(err),
        });
      },
    );
    maybeIndexSession({
      sessionId: chatSessionId,
      activeSessionIds: getActiveSessionIds(),
    }).catch((err) => {
      log.warn("chat-index", "unexpected error in background", {
        error: String(err),
      });
    });
    // Walks wiki/pages/ for files modified during this turn and
    // appends a backlink to the originating chat session so the
    // user can jump back from a wiki page to the conversation
    // that created it. See #109.
    maybeAppendWikiBacklinks({
      chatSessionId,
      turnStartedAt: requestStartedAt,
    }).catch((err) => {
      log.warn("wiki-backlinks", "unexpected error in background", {
        error: String(err),
      });
    });
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
        if (entry.type === "claude_session_id" && entry.id) return entry.id;
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
