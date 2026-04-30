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
  /** Bridge-only legacy carrier for "the user picked this image".
   *  No in-tree bridge sets it today; it remains on the type so
   *  external bridge clients that populate it from older protocol
   *  versions continue to work. The Vue UI never sets this — paste/
   *  drop and sidebar picks ride on `attachments[]` as path-only
   *  entries instead. When set, `startChat` normalises the value
   *  into a synthetic `Attachment` and prepends it to `attachments`
   *  before any downstream processing. */
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
  // Bridge-only compat: external bridge clients may still populate
  // `selectedImageData`. Fold it into `attachments` so the rest of
  // this function only deals with one input shape.
  const normalisedAttachments = mergeBridgeSelectedImage(selectedImageData, attachments);

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

  // Roll the run back if attachment prep throws (e.g. malformed
  // HTTP body where `attachments` isn't an array). beginRun already
  // committed; without endRun + abort the session is stuck and every
  // future turn is rejected with 409.
  let extras: RequestExtras;
  try {
    extras = await prepareRequestExtras(normalisedAttachments);
  } catch (err) {
    log.warn("agent", "prepareRequestExtras failed — rolling back run", { chatSessionId, error: errorMessage(err) });
    abortController.abort();
    endRun(chatSessionId);
    return { kind: "error", error: "Invalid attachments payload", status: 400 };
  }
  const baseMessage = claudeSessionId ? message : prependJournalPointer(message, workspacePath);
  const decoratedMessage = withAttachedFileMarker(baseMessage, extras.attachedFilePaths);

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
  /** Workspace-relative paths of every file the user attached or
   *  selected for this turn, in declaration order. Surfaced to the
   *  LLM via one `[Attached file: <path>]` line per entry, prepended
   *  to the user message so path-passing tools (e.g. `editImages`)
   *  and the LLM itself can reference each file by path. Empty when
   *  the request carried only inline bridge bytes (no paths) or
   *  nothing at all. */
  attachedFilePaths: string[];
}

/** Bridge-only compat: external bridge clients may still ship a
 *  picked image via `StartChatParams.selectedImageData`. Convert
 *  that single value to a synthetic `Attachment` and prepend it to
 *  the explicit `attachments` array so downstream code only has to
 *  understand one input shape. The Vue UI never reaches this branch
 *  — it sends path-only attachments directly. */
function mergeBridgeSelectedImage(selectedImageData: string | undefined, attachments: Attachment[] | undefined): Attachment[] | undefined {
  const synthetic = synthesiseBridgeAttachment(selectedImageData);
  if (!synthetic) return attachments;
  return attachments && attachments.length > 0 ? [synthetic, ...attachments] : [synthetic];
}

function synthesiseBridgeAttachment(selectedImageData: string | undefined): Attachment | undefined {
  if (!selectedImageData) return undefined;
  if (isAttachmentPath(selectedImageData) || isImagePath(selectedImageData)) {
    return { path: selectedImageData };
  }
  const parsed = parseDataUrl(selectedImageData);
  if (parsed) return { mimeType: parsed.mimeType, data: parsed.data };
  log.warn("agent", "bridge selectedImageData is neither a known path nor a data: URL — dropping", {
    valuePreview: selectedImageData.slice(0, 64),
  });
  return undefined;
}

/** Walk `attachments[]` once, loading bytes from disk for any
 *  path-only entry, and collect every path-bearing entry so the
 *  caller can emit one `[Attached file: <path>]` marker per file.
 *  Two path roots are accepted:
 *
 *    - `data/attachments/...` — paste/drop/file-picker uploads (any
 *      MIME type from the chat input's accept list). MIME is inferred
 *      from the extension chosen at save time.
 *    - `artifacts/images/...png` — generated / canvas / edited images
 *      a user picked from the sidebar. Always image/png.
 *
 *  Bytes are loaded so Claude still "sees" each file as a content
 *  block on this turn, AND every path is returned separately so the
 *  caller marks them in the LLM-bound message. If a file can't be
 *  read, its path hint is still emitted — the LLM knows what was
 *  attached and can call Read to load it. Multi-file flows (e.g.
 *  paste one image + pick another in the sidebar → "combine these")
 *  rely on every path showing up in the marker so `editImages` can
 *  receive the full list in `imagePaths`. */
async function prepareRequestExtras(attachments: Attachment[] | undefined): Promise<RequestExtras> {
  if (!attachments || attachments.length === 0) {
    return { attachments: undefined, attachedFilePaths: [] };
  }
  const result: Attachment[] = [];
  const attachedFilePaths: string[] = [];
  for (const att of attachments) {
    const resolved = await resolveAttachment(att);
    if (resolved) result.push(resolved);
    if (typeof att.path === "string" && att.path.length > 0) {
      attachedFilePaths.push(att.path);
    }
  }
  return {
    attachments: result.length > 0 ? result : undefined,
    attachedFilePaths,
  };
}

async function resolveAttachment(att: Attachment): Promise<Attachment | undefined> {
  if (typeof att.path === "string" && att.path.length > 0) {
    return loadFromPath(att.path, att.mimeType);
  }
  if (typeof att.data === "string" && att.data.length > 0) {
    return att;
  }
  log.warn("agent", "attachment has neither path nor data — dropping");
  return undefined;
}

async function loadFromPath(value: string, declaredMimeType: string | undefined): Promise<Attachment | undefined> {
  if (isAttachmentPath(value)) return loadAttachmentFromPath(value, declaredMimeType);
  if (isImagePath(value)) return loadImageFromPath(value, declaredMimeType);
  log.warn("agent", "attachment path is outside allowed roots — dropping", { path: value });
  return undefined;
}

async function loadAttachmentFromPath(value: string, declaredMimeType: string | undefined): Promise<Attachment | undefined> {
  const mimeType = declaredMimeType ?? inferMimeFromExtension(value);
  if (!mimeType) {
    log.warn("agent", "attachment path has unknown extension — skipping bytes", { path: value });
    return undefined;
  }
  try {
    const data = await loadAttachmentBase64(value);
    return { mimeType, data, path: value };
  } catch (err) {
    log.warn("agent", "failed to load attachment bytes from path", { path: value, error: errorMessage(err) });
    return undefined;
  }
}

async function loadImageFromPath(value: string, declaredMimeType: string | undefined): Promise<Attachment | undefined> {
  try {
    const data = await loadImageBase64(value);
    return { mimeType: declaredMimeType ?? "image/png", data, path: value };
  } catch (err) {
    log.warn("agent", "failed to load selected-image bytes from path", { path: value, error: errorMessage(err) });
    return undefined;
  }
}

/** Marker prepended to the LLM-bound user message that tells the
 *  model which workspace files are attached / selected for this turn.
 *  One `[Attached file: <path>]` line is emitted per path so multi-
 *  file flows (e.g. paste one image + pick another → "combine these")
 *  surface every path to the model — `editImages` then receives the
 *  full list in `imagePaths`. The user's persisted (jsonl) and
 *  broadcast (UI) message is the raw text — these marker lines are
 *  added strictly on the path to Claude. The system prompt teaches
 *  the model how to interpret them. */
export function withAttachedFileMarker(message: string, attachedFilePaths: string[]): string {
  if (attachedFilePaths.length === 0) return message;
  const markerLines = attachedFilePaths.map((relPath) => `[Attached file: ${relPath}]`).join("\n");
  return `${markerLines}\n\n${message}`;
}

// ── HTTP route ──────────────────────────────────────────────────────

// HTTP route body — used by the Vue UI only. Paste/drop and sidebar
// pick both ride on `attachments[]` as path-only entries; the server
// reads bytes from disk and emits the `[Attached file: <path>]`
// marker. Bridges go through the socket relay (see chat-service)
// and supply attachments with inline base64 bytes; both shapes
// share the same `Attachment` type. See plans/refactor-edit-images-array.md.
interface AgentBody {
  message: string;
  roleId: string;
  chatSessionId: string;
  attachments?: Attachment[];
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
