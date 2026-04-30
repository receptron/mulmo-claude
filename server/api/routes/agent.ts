import { Router, Request, Response } from "express";
import { getSessionQuery } from "../../utils/request.js";
import {
  createSessionMeta,
  backfillFirstUserMessage as backfillMeta,
  backfillOrigin,
  readSessionMetaFull,
  readSessionMeta,
  setClaudeSessionId as setClaudeId,
  clearClaudeSessionId as clearClaudeId,
  appendSessionLine,
  readSessionJsonl,
  sessionJsonlAbsPath,
  ensureChatDir,
} from "../../utils/files/session-io.js";
import { getRole } from "../../workspace/roles.js";
import { runAgent } from "../../agent/index.js";
import { prependJournalPointer } from "../../agent/prompt.js";
import { buildTranscriptPreamble, isStaleSessionError } from "../../agent/resumeFailover.js";
import { getOrCreateSession, beginRun, endRun, cancelRun, pushSessionEvent, pushToolResult, getActiveSessionIds } from "../../events/session-store/index.js";
import { workspacePath } from "../../workspace/workspace.js";
import { maybeRunJournal } from "../../workspace/journal/index.js";
import { maybeIndexSession } from "../../workspace/chat-index/index.js";
import { maybeAppendWikiBacklinks } from "../../workspace/wiki-backlinks/index.js";
import { log } from "../../system/logger/index.js";
import { logBackgroundError } from "../../utils/logBackgroundError.js";
import { createArgsCache, recordToolEvent } from "../../workspace/tool-trace/index.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { isSessionOrigin, type SessionOrigin } from "../../../src/types/session.js";
// Imports kept commented (instead of deleted) alongside the
// publishNotification call below — see the duplicate-notification
// comment near `endRun()` in `runAgentInBackground` for context.
// `SESSION_ORIGINS` is dragged into this same commented block
// because every remaining live reference to it lived inside the
// commented helper / call site; once those went, leaving the value
// import un-commented would trip the unused-import lint rule.
// (by snakajima)
// import { SESSION_ORIGINS } from "../../../src/types/session.js";
// import { NOTIFICATION_KINDS } from "../../../src/types/notification.js";
// import { publishNotification } from "../../events/notifications.js";
import { env } from "../../system/env.js";
import type { Attachment } from "@mulmobridge/protocol";
import { parseDataUrl } from "@mulmobridge/client";
import { isImagePath, loadImageBase64 } from "../../utils/files/image-store.js";
import { isAttachmentPath, loadAttachmentBase64, inferMimeFromExtension } from "../../utils/files/attachment-store.js";
import { errorMessage } from "../../utils/errors.js";

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
  return serialised.length > TOOL_ARGS_LOG_PREVIEW_MAX ? `${serialised.slice(0, TOOL_ARGS_LOG_PREVIEW_MAX)}…` : serialised;
}

// Called by the MCP server to push a ToolResult into the active session.
interface OkResponse {
  ok: boolean;
}

router.post(API_ROUTES.agent.internal.toolResult, async (req: Request<object, unknown, Record<string, unknown>>, res: Response<OkResponse>) => {
  const chatSessionId = getSessionQuery(req);
  const outcome = await pushToolResult(chatSessionId, req.body);
  res.json({ ok: outcome.kind === "processed" });
});

// Cancel a running agent session by killing the Claude CLI process.
interface CancelBody {
  chatSessionId: string;
}

router.post(API_ROUTES.agent.cancel, (req: Request<object, unknown, CancelBody>, res: Response<OkResponse>) => {
  const { chatSessionId } = req.body;
  if (!chatSessionId) {
    res.json({ ok: false });
    return;
  }
  const ok = cancelRun(chatSessionId);
  res.json({ ok });
});

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
  /** Where this session originates (#486). Accepts string for
   *  cross-package compatibility (chat-service passes string). */
  origin?: string;
  /** IANA timezone the user's browser resolved (e.g. "Asia/Tokyo").
   *  Validated server-side before it reaches the system prompt — an
   *  invalid or missing value falls back to server-local time. */
  userTimezone?: string;
  /** Flat primitive bag forwarded from the bridge handshake, string
   *  / number / boolean values only (see plans/feat-bridge-options-
   *  passthrough.md). The session-level `defaultRole` override is
   *  already applied upstream in chat-service; MulmoClaude doesn't
   *  read any other keys today. Accepted here so the typing matches
   *  `StartChatFn` exported by chat-service. */
  bridgeOptions?: Readonly<Record<string, string | number | boolean>>;
}

export type StartChatResult = { kind: "started"; chatSessionId: string } | { kind: "error"; error: string; status?: number };

export async function startChat(params: StartChatParams): Promise<StartChatResult> {
  const { message, roleId, chatSessionId, selectedImageData, attachments, userTimezone } = params;

  if (!message || !roleId || !chatSessionId) {
    return {
      kind: "error",
      error: "message, roleId, and chatSessionId are required",
      status: 400,
    };
  }

  ensureChatDir();
  const resultsFilePath = sessionJsonlAbsPath(chatSessionId);

  // Discriminate missing (first turn) from corrupt (warn, don't clobber).
  const metaResult = await readSessionMetaFull(chatSessionId);
  const isFirstTurn = metaResult.kind === "missing";
  if (metaResult.kind === "corrupt") {
    log.warn("agent", "session meta is corrupt — treating as existing", {
      chatSessionId,
    });
  }
  const persistedHasUnread = metaResult.kind === "ok" && metaResult.meta.hasUnread === true ? true : undefined;

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
  const validOrigin = isSessionOrigin(params.origin) ? params.origin : undefined;
  if (isFirstTurn) {
    await createSessionMeta(chatSessionId, roleId, message, undefined, validOrigin);
  } else {
    await backfillMeta(chatSessionId, message);
    if (validOrigin) {
      await backfillOrigin(chatSessionId, validOrigin);
    }
  }

  // Append user message for this turn
  await appendSessionLine(chatSessionId, JSON.stringify({ source: "user", type: EVENT_TYPES.text, message }));

  // Broadcast the user message so other tabs viewing this session
  // see the input in real time. Runs AFTER beginRun so a 409 never
  // produces a phantom user message in other clients.
  pushSessionEvent(chatSessionId, {
    type: EVENT_TYPES.text,
    source: "user",
    message,
  });

  const role = getRole(roleId);
  const claudeSessionId = await readClaudeSessionIdFromSession(chatSessionId);

  const requestStartedAt = Date.now();
  log.info("agent", "request received", {
    chatSessionId,
    roleId,
    messageLen: message.length,
    resumed: Boolean(claudeSessionId),
  });

  const extras = await prepareRequestExtras(selectedImageData, attachments);
  const baseMessage = claudeSessionId ? message : prependJournalPointer(message, workspacePath);
  const decoratedMessage = withAttachedFileMarker(baseMessage, extras.attachedFilePath);

  runAgentInBackground({
    decoratedMessage,
    role,
    chatSessionId,
    claudeSessionId,
    abortSignal: abortController.signal,
    resultsFilePath,
    requestStartedAt,
    toolArgsCache: createArgsCache(),
    attachments: extras.attachments,
    userTimezone,
    origin: validOrigin,
  });

  return { kind: "started", chatSessionId };
}

// ── Helpers ──────────────────────────────────────────────────────────

interface RequestExtras {
  attachments: Attachment[] | undefined;
  /** Workspace-relative path of the file the user attached / has
   *  selected for this turn. Surfaced to the LLM via an
   *  `[Attached file: <path>]` marker prepended to the user
   *  message so path-passing tools (e.g. `editImage`) and the LLM
   *  itself can reference the file by path. Undefined when the
   *  request carried only inline data (legacy bridge client) or
   *  nothing at all. */
  attachedFilePath: string | undefined;
}

/** Convert `selectedImageData` (workspace-relative path of a file
 *  the user attached / selected, or — for legacy bridge clients —
 *  a `data:` URL) into the generic Attachment format and a path
 *  hint, then merge with any explicitly-provided attachments from
 *  the bridge protocol.
 *
 *  Two path roots are accepted:
 *    - `data/attachments/...` — paste/drop/file-picker uploads (any
 *      MIME type from the chat input's accept list). MIME is inferred
 *      from the extension chosen at save time.
 *    - `artifacts/images/...png` — generated / canvas / edited images
 *      a user picked from the sidebar. Always image/png.
 *
 *  Bytes are loaded from disk so Claude still "sees" the file as a
 *  content block on this turn, AND the path is returned separately
 *  so the caller marks it in the LLM-bound message. If the file
 *  can't be read, the path hint is still emitted — the LLM knows
 *  what was attached and can call Read to load it. */
async function prepareRequestExtras(selectedImageData: string | undefined, explicit: Attachment[] | undefined): Promise<RequestExtras> {
  const primary = selectedImageData ? await resolvePrimaryAttachment(selectedImageData) : undefined;
  const result: Attachment[] = [];
  if (primary?.attachment) result.push(primary.attachment);
  if (explicit) result.push(...explicit);
  return {
    attachments: result.length > 0 ? result : undefined,
    attachedFilePath: primary?.attachedFilePath,
  };
}

interface PrimaryAttachment {
  attachment: Attachment | undefined;
  attachedFilePath: string | undefined;
}

async function resolvePrimaryAttachment(value: string): Promise<PrimaryAttachment> {
  if (isAttachmentPath(value)) {
    return { attachment: await loadFromAttachmentPath(value), attachedFilePath: value };
  }
  if (isImagePath(value)) {
    return { attachment: await loadFromImagePath(value), attachedFilePath: value };
  }
  const parsed = parseDataUrl(value);
  return {
    attachment: parsed ? { mimeType: parsed.mimeType, data: parsed.data } : undefined,
    attachedFilePath: undefined,
  };
}

async function loadFromAttachmentPath(value: string): Promise<Attachment | undefined> {
  const mimeType = inferMimeFromExtension(value);
  if (!mimeType) {
    log.warn("agent", "attachment path has unknown extension — skipping bytes", { path: value });
    return undefined;
  }
  try {
    const data = await loadAttachmentBase64(value);
    return { mimeType, data };
  } catch (err) {
    log.warn("agent", "failed to load attachment bytes from path", {
      path: value,
      error: errorMessage(err),
    });
    return undefined;
  }
}

async function loadFromImagePath(value: string): Promise<Attachment | undefined> {
  try {
    const data = await loadImageBase64(value);
    return { mimeType: "image/png", data };
  } catch (err) {
    log.warn("agent", "failed to load selected-image bytes from path", {
      path: value,
      error: errorMessage(err),
    });
    return undefined;
  }
}

/** Marker prepended to the LLM-bound user message that tells the
 *  model which workspace file is attached / selected for this turn.
 *  The user's persisted (jsonl) and broadcast (UI) message is the
 *  raw text — this marker is added strictly on the path to Claude.
 *  The system prompt teaches the model how to interpret it. */
function withAttachedFileMarker(message: string, attachedFilePath: string | undefined): string {
  return attachedFilePath ? `[Attached file: ${attachedFilePath}]\n\n${message}` : message;
}

// ── HTTP route ──────────────────────────────────────────────────────

// HTTP route body — used by the Vue UI only. `selectedImageData` is
// the legacy data-URL path; new bridge clients send `attachments`
// via the socket relay instead. mergeAttachments() unifies both
// paths inside startChat(). See #382 for the rationale.
interface AgentBody {
  message: string;
  roleId: string;
  chatSessionId: string;
  selectedImageData?: string;
  userTimezone?: string;
}

interface ErrorResponse {
  error: string;
}

interface AcceptedResponse {
  chatSessionId: string;
}

router.post(API_ROUTES.agent.run, async (req: Request<object, unknown, AgentBody>, res: Response<ErrorResponse | AcceptedResponse>) => {
  const result = await startChat(req.body);
  if (result.kind === "error") {
    res.status(result.status ?? 500).json({ error: result.error });
    return;
  }
  res.status(202).json({ chatSessionId: result.chatSessionId });
});

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
  requestStartedAt: number;
  toolArgsCache: ReturnType<typeof createArgsCache>;
  attachments: Attachment[] | undefined;
  userTimezone: string | undefined;
  // Where this run was triggered from. Used to decide whether to
  // fire a completion notification: human-initiated runs don't (the
  // user is right there in the UI), but scheduler / bridge / skill
  // runs do (the user is probably away from the keyboard).
  origin: SessionOrigin | undefined;
}

// Per-event side-effect context passed to `handleAgentEvent`.
// `textAccumulator` collects streaming text chunks so we write
// one consolidated line to the jsonl instead of per-chunk lines
// (which would appear as separate cards on session reload).
interface EventContext {
  chatSessionId: string;
  resultsFilePath: string;
  toolArgsCache: ReturnType<typeof createArgsCache>;
  textAccumulator: string[];
}

// Returns true if the event was handled "out of band" (no pub-sub
// broadcast, no jsonl append). Right now only `claudeSessionId`
// events fall into that bucket — they update meta and are otherwise
// invisible to clients. Everything else is treated as "normal flow":
// broadcast + optional jsonl append + optional tool-trace side effect.
async function handleAgentEvent(event: Awaited<ReturnType<typeof runAgent>> extends AsyncGenerator<infer E> ? E : never, ctx: EventContext): Promise<void> {
  if (event.type === EVENT_TYPES.claudeSessionId) {
    await flushTextAccumulator(ctx);
    await setClaudeId(ctx.chatSessionId, event.id);
    return;
  }
  pushSessionEvent(ctx.chatSessionId, event as Record<string, unknown>);

  if (event.type === EVENT_TYPES.text) {
    // Accumulate text chunks instead of writing each one to jsonl.
    // Flushed when a non-text event arrives (preserving jsonl order
    // relative to tool events) or when the run ends.
    ctx.textAccumulator.push(event.message);
    return;
  }
  // Any non-text event marks the end of a text burst — flush so
  // jsonl order matches the live stream and crashes mid-run don't
  // lose already-streamed text.
  await flushTextAccumulator(ctx);
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

// Write the accumulated streaming text chunks as one consolidated
// jsonl line. Called at the end of each agent run (success or error)
// so the session transcript has exactly one assistant text entry
// per response, not N per-chunk entries.
async function flushTextAccumulator(ctx: EventContext): Promise<void> {
  if (ctx.textAccumulator.length === 0) return;
  const fullText = ctx.textAccumulator.join("");
  ctx.textAccumulator.length = 0;
  if (!fullText) return;
  await appendSessionLine(
    ctx.chatSessionId,
    JSON.stringify({
      source: "assistant",
      type: EVENT_TYPES.text,
      message: fullText,
    }),
  );
}

// Helper kept commented (instead of deleted) alongside the
// publishNotification call below — see the duplicate-notification
// comment near `endRun()` in `runAgentInBackground` for context.
// (by snakajima)
//
// // Build the title used for the agent-completion notification on
// // non-human runs. Surfaces both the role name and the trigger so
// // the user can read it in passing on a phone lock screen.
// function completionNotificationTitle(roleName: string, origin: SessionOrigin): string {
//   switch (origin) {
//     case SESSION_ORIGINS.scheduler:
//       return `✅ ${roleName} (scheduler) finished`;
//     case SESSION_ORIGINS.skill:
//       return `✅ ${roleName} (skill) finished`;
//     case SESSION_ORIGINS.bridge:
//       return `✅ ${roleName} reply ready`;
//     default:
//       return `✅ ${roleName} finished`;
//   }
// }

async function runAgentInBackground(params: BackgroundRunParams): Promise<void> {
  const { decoratedMessage, role, chatSessionId, claudeSessionId, abortSignal, resultsFilePath, requestStartedAt, toolArgsCache, attachments, userTimezone } =
    params;

  const eventCtx: EventContext = {
    chatSessionId,
    resultsFilePath,
    toolArgsCache,
    textAccumulator: [],
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
      for await (const event of runAgent({
        message: currentMessage,
        role,
        workspacePath,
        sessionId: chatSessionId,
        port: PORT,
        claudeSessionId: currentClaudeSessionId,
        abortSignal,
        attachments,
        userTimezone,
      })) {
        if (failoverAttemptsRemaining > 0 && event.type === EVENT_TYPES.error && typeof event.message === "string" && isStaleSessionError(event.message)) {
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
      await clearClaudeId(chatSessionId);
      const preamble = await readTranscriptPreamble(chatSessionId);
      currentMessage = preamble ? `${preamble}${decoratedMessage}` : decoratedMessage;
      currentClaudeSessionId = undefined;
      pushSessionEvent(chatSessionId, {
        type: EVENT_TYPES.status,
        message: "Previous session unavailable — continuing with local transcript.",
      });
    }
    // Flush any accumulated streaming text as a single consolidated
    // line in the jsonl. This prevents per-chunk lines that would
    // appear as separate cards on session reload.
    await flushTextAccumulator(eventCtx);

    log.info("agent", "request completed", {
      chatSessionId,
      durationMs: Date.now() - requestStartedAt,
    });
  } catch (err) {
    await flushTextAccumulator(eventCtx);
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
    // Commented out: this would create a duplicate notification.
    //
    // `endRun(chatSessionId)` above flips `session.hasUnread = true`
    // for every chat-session turn completion regardless of origin,
    // which already lights up the red unread-count badge on the
    // Session History Panel toggle button (driven by `hasUnread` →
    // `useSessionDerived.unreadCount` →
    // `SessionHistoryToggleButton.vue`). Firing
    // `publishNotification` here adds a *second* red badge — on the
    // notification bell — for the exact same event, in the same
    // chrome row. Two indicators, one event = noise.
    //
    // The duplicate occurs whenever a chat session receives a new
    // message, which is exactly what every code path through this
    // `finally` represents. The initiator of the turn (human, bridge
    // user, scheduled job, skill chain, another agent) does not
    // change this — both badges flip together.
    //
    // Other `publishNotification` call sites (news pipeline, `notify`
    // MCP tool, scheduled-test endpoint) do not post a chat-session
    // message at the same time, so they are not duplicates and
    // remain enabled.
    //
    // (by snakajima)
    //
    // if (params.origin && params.origin !== SESSION_ORIGINS.human) {
    //   publishNotification({
    //     kind: NOTIFICATION_KINDS.agent,
    //     title: completionNotificationTitle(params.role.name, params.origin),
    //     sessionId: chatSessionId,
    //   });
    // }
    // Fire-and-forget: journal + chat-index post-processing
    maybeRunJournal({ activeSessionIds: getActiveSessionIds() }).catch(logBackgroundError("journal"));
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

// Read claudeSessionId from meta (primary) or jsonl (legacy fallback).
async function readClaudeSessionIdFromSession(chatSessionId: string): Promise<string | undefined> {
  const meta = await readSessionMeta(chatSessionId);
  if (meta?.claudeSessionId) return meta.claudeSessionId as string;
  // Legacy scan: search jsonl lines backwards for a claudeSessionId event
  const jsonl = await readSessionJsonl(chatSessionId);
  if (!jsonl) return undefined;
  const lines = jsonl.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === EVENT_TYPES.claudeSessionId && entry.id) return entry.id;
    } catch {
      // skip malformed lines
    }
  }
  return undefined;
}

// Read the session jsonl and render the transcript preamble used on
// `--resume` fail-over.
async function readTranscriptPreamble(chatSessionId: string): Promise<string> {
  const jsonl = await readSessionJsonl(chatSessionId);
  if (!jsonl) return "";
  return buildTranscriptPreamble(jsonl);
}

export default router;
