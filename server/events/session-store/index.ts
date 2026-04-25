// Server-side session state store. Replaces the lightweight
// `server/sessions.ts` SSE-send registry with a pub/sub-backed
// store that holds authoritative state per chat session. Multiple
// clients can subscribe to the same session channel and receive
// identical events.

import { appendFile } from "fs/promises";
import type { IPubSub } from "../pub-sub/index.js";
import { PUBSUB_CHANNELS, sessionChannel } from "../../../src/config/pubsubChannels.js";
import { log } from "../../system/logger/index.js";
import { updateHasUnread } from "../../utils/files/session-io.js";
import { EVENT_TYPES, GENERATION_KINDS, type GenerationKind, type PendingGeneration, generationKey } from "../../../src/types/events.js";
import { ONE_DAY_MS, ONE_HOUR_MS, ONE_MINUTE_MS } from "../../utils/time.js";
import { env } from "../../system/env.js";

// ── Types ──────────────────────────────────────────────────────

export interface ToolCallHistoryItem {
  toolUseId: string;
  toolName: string;
  args: unknown;
  timestamp: number;
  result?: string;
  error?: string;
}

export interface ServerSession {
  chatSessionId: string;
  roleId: string;
  isRunning: boolean;
  hasUnread: boolean;
  statusMessage: string;
  toolCallHistory: ToolCallHistoryItem[];
  resultsFilePath: string;
  selectedImageData?: string;
  startedAt: string;
  updatedAt: string;
  /** Kills the spawned Claude CLI process for this session. */
  abortRun?: () => void;
  /**
   * Set true by `cancelRun` and consumed by `endRun` so the agent
   * route can roll the session jsonl back to its pre-turn size when
   * a Stop button cancel ended the run. Stays in step with a
   * matching `turnStartJsonlSize` snapshot taken in `beginRun`. See
   * the Stop-as-undo flow in #821 / #822.
   */
  cancelled?: boolean;
  /**
   * Byte offset of the session jsonl at the moment `beginRun` was
   * called — i.e. before the user message line was appended. The
   * cancel path truncates the file back to this offset so the
   * cancelled turn doesn't survive on disk and reappear on the next
   * `GET /api/sessions/:id`.
   */
  turnStartJsonlSize?: number;
  /**
   * In-flight background generations keyed by `generationKey(kind, filePath, key)`.
   * The value carries the decomposed (kind, filePath, key) so consumers never
   * have to parse the opaque composite key back out. Non-empty means the
   * session has ongoing work even when `isRunning` (agent turn) is false —
   * used to keep the busy indicator lit across view navigation.
   */
  pendingGenerations: Record<string, PendingGeneration>;
}

// ── Constants ──────────────────────────────────────────────────

const IDLE_EVICTION_MS = ONE_HOUR_MS;
const EVICTION_CHECK_INTERVAL_MS = 5 * ONE_MINUTE_MS;

// ── Store ──────────────────────────────────────────────────────

const store = new Map<string, ServerSession>();
/**
 * Parallel pending-generation tracking for sessions that aren't in the
 * in-memory store. The MulmoScript view can be opened on a session
 * whose full ServerSession entry never existed or was evicted after
 * idle timeout — we still want to mark unread and fire
 * notifySessionsChanged when the work drains. Cleared on drain.
 */
const storelessPending = new Map<string, Set<string>>();
let pubsub: IPubSub | null = null;
let evictionTimer: ReturnType<typeof setInterval> | null = null;

export function initSessionStore(pubSubInstance: IPubSub): void {
  pubsub = pubSubInstance;
  if (evictionTimer) clearInterval(evictionTimer);
  evictionTimer = setInterval(evictIdleSessions, EVICTION_CHECK_INTERVAL_MS);
}

// ── Session lifecycle ──────────────────────────────────────────

export function getSession(chatSessionId: string): ServerSession | undefined {
  return store.get(chatSessionId);
}

export function getOrCreateSession(
  chatSessionId: string,
  opts: {
    roleId: string;
    resultsFilePath: string;
    selectedImageData?: string;
    startedAt: string;
    updatedAt: string;
    hasUnread?: boolean;
  },
): ServerSession {
  const existing = store.get(chatSessionId);
  if (existing) {
    existing.selectedImageData = opts.selectedImageData;
    existing.updatedAt = opts.updatedAt;
    return existing;
  }
  const session: ServerSession = {
    chatSessionId,
    roleId: opts.roleId,
    isRunning: false,
    hasUnread: opts.hasUnread ?? false,
    statusMessage: "",
    toolCallHistory: [],
    resultsFilePath: opts.resultsFilePath,
    selectedImageData: opts.selectedImageData,
    startedAt: opts.startedAt,
    updatedAt: opts.updatedAt,
    pendingGenerations: {},
  };
  store.set(chatSessionId, session);
  return session;
}

function removeSession(chatSessionId: string): void {
  store.delete(chatSessionId);
  notifySessionsChanged();
}

// Tombstones for sessions purged off-disk (currently only the first-
// turn cancel path #822). The /api/sessions list endpoint reads this
// to populate the response's `deletedIds` array so cursor-based
// clients drop the deleted ids from their cached lists. The TTL
// matches the sessions-list horizon: a tombstone older than that
// can no longer matter because the corresponding session row is
// already off the list anyway. Eviction happens on BOTH the write
// path (purgeSession) and the read path (getRecentlyPurgedSessionIds)
// so tombstones don't linger forever in a quiet server — Codex
// iter-2 #822.
const SESSIONS_TOMBSTONE_TTL_MS = env.sessionsListWindowDays * ONE_DAY_MS;
const recentlyPurgedSessions = new Map<string, number>();

function evictOldTombstones(now: number): void {
  for (const [sessionId, deletedAt] of recentlyPurgedSessions) {
    if (now - deletedAt > SESSIONS_TOMBSTONE_TTL_MS) {
      recentlyPurgedSessions.delete(sessionId);
    }
  }
}

/** Purge the session's in-memory state, record a tombstone for
 *  cursor-aware clients, and broadcast a sessions-changed
 *  notification. Used by the first-turn cancel path (#822) to evict
 *  the empty session from the sidebar history after the meta +
 *  jsonl have been deleted from disk. Other tabs then re-fetch the
 *  summaries via the broadcast and drop this id via `deletedIds`. */
export function purgeSession(chatSessionId: string): void {
  const now = Date.now();
  evictOldTombstones(now);
  recentlyPurgedSessions.set(chatSessionId, now);
  removeSession(chatSessionId);
}

/** Tombstones for sessions purged in the last
 *  SESSIONS_TOMBSTONE_TTL_MS window. Returned by the sessions list
 *  endpoint so clients can drop deleted ids from their cached lists.
 *  `sinceMs === 0` (no cursor) returns every live tombstone — fine
 *  because the response is the full session list anyway. Evicts
 *  expired entries on the way out so a quiet server still cleans
 *  up after itself. */
export function getRecentlyPurgedSessionIds(sinceMs: number): string[] {
  evictOldTombstones(Date.now());
  const cutoff = sinceMs > 0 ? sinceMs : 0;
  const result: string[] = [];
  for (const [sessionId, deletedAt] of recentlyPurgedSessions) {
    if (deletedAt >= cutoff) result.push(sessionId);
  }
  return result;
}

// ── State mutations (publish to pub/sub) ───────────────────────

/** Mark a session as running. Rejects if already running (409).
 *  `turnStartJsonlSize` is the jsonl byte offset before the user
 *  message line was appended — captured by the caller and stored
 *  here so cancelRun/endRun can roll the file back to it (#822). */
export function beginRun(chatSessionId: string, abortRun: () => void, turnStartJsonlSize?: number): boolean {
  const session = store.get(chatSessionId);
  if (!session) return false;
  if (session.isRunning) return false;
  session.isRunning = true;
  session.statusMessage = "";
  session.toolCallHistory = [];
  session.abortRun = abortRun;
  session.cancelled = false;
  session.turnStartJsonlSize = turnStartJsonlSize;
  session.updatedAt = new Date().toISOString();
  notifySessionsChanged();
  return true;
}

/** Mark a session as finished. Sets hasUnread = true. */
export function endRun(chatSessionId: string): void {
  const session = store.get(chatSessionId);
  if (!session) return;
  session.isRunning = false;
  session.hasUnread = true;
  session.statusMessage = "";
  session.abortRun = undefined;
  session.updatedAt = new Date().toISOString();
  persistHasUnread(chatSessionId, true);
  publishToSessionChannel(chatSessionId, {
    type: EVENT_TYPES.sessionFinished,
  });
  notifySessionsChanged();
}

/** Cancel a running session by killing the child process. The
 *  `cancelled` flag is read in `endRun` (and by the agent route's
 *  per-turn jsonl-truncation step) to roll the on-disk log back to
 *  before this turn started. See #822. */
export function cancelRun(chatSessionId: string): boolean {
  const session = store.get(chatSessionId);
  if (!session?.isRunning || !session.abortRun) return false;
  session.cancelled = true;
  session.abortRun();
  return true;
}

/** True iff the most-recent run for this session was cancelled by
 *  `cancelRun` (rather than completed naturally). The agent route
 *  consumes this in its post-run cleanup to decide whether to
 *  truncate the jsonl back to `getTurnStartJsonlSize`. Returns
 *  false for unknown sessions. */
export function wasCancelled(chatSessionId: string): boolean {
  return store.get(chatSessionId)?.cancelled ?? false;
}

/** Byte offset captured in `beginRun` — the jsonl size before the
 *  user message of the current/most-recent turn was appended. Used
 *  by the cancel rollback path. Returns undefined for unknown
 *  sessions or runs created before this field existed. */
export function getTurnStartJsonlSize(chatSessionId: string): number | undefined {
  return store.get(chatSessionId)?.turnStartJsonlSize;
}

/** Clear the unread flag (called when a client views the session).
 *  Awaits the disk write so the caller can respond only after the
 *  flag is actually persisted — avoids the race where the client
 *  refetches before the write lands and sees the stale value. */
export async function markRead(chatSessionId: string): Promise<void> {
  const session = store.get(chatSessionId);
  if (!session) {
    // No in-memory session — still persist to disk so the flag is
    // cleared for the next server restart / session listing.
    await persistHasUnread(chatSessionId, false);
    return;
  }
  if (!session.hasUnread) return;
  session.hasUnread = false;
  await persistHasUnread(chatSessionId, false);
  notifySessionsChanged();
}

// ── Event publishing ───────────────────────────────────────────

/** Publish an agent event to the session's channel + update store. */
export function pushSessionEvent(chatSessionId: string, event: Record<string, unknown>): void {
  const type = event.type as string;
  const isGenerationEvent = type === EVENT_TYPES.generationStarted || type === EVENT_TYPES.generationFinished;

  // Non-generation events keep the pre-existing "store or drop"
  // behavior: toolCall / toolCallResult / status fire only during a
  // live agent turn (which always has a store entry), and
  // rolesUpdated / sessionFinished are equally tied to in-store
  // sessions. Publishing them for evicted sessions would broaden the
  // wire contract without a concrete need.
  //
  // Generation events are the exception — a plugin view (e.g.
  // MulmoScript) can kick off work on a session whose store entry
  // never existed or was evicted after idle timeout, and the client
  // subscription lives on the channel, not on any server-side
  // session object. We always deliver those so the UI can update.
  const session = store.get(chatSessionId);
  if (!session && !isGenerationEvent) return;
  publishToSessionChannel(chatSessionId, event);

  const generationDelta = resolveGenerationDelta(chatSessionId, type, event);
  if (generationDelta === "same") return;
  if (generationDelta === "started") {
    notifySessionsChanged();
    return;
  }

  // Drained: flag hasUnread, same semantics as endRun(). Clients
  // viewing the session clear it via markRead.
  if (session) {
    session.hasUnread = true;
    // Store is the source of truth, so the refetch already sees the
    // flag via `live.hasUnread` — the disk write is just a backstop
    // across server restarts and can stay fire-and-forget.
    persistHasUnread(chatSessionId, true).catch(() => {});
    notifySessionsChanged();
    return;
  }

  // Storeless: meta.hasUnread on disk is the ONLY place the flag lives.
  // If we notified before the write completed, the client's refetch
  // would read the stale pre-drain value. Sequence: persist, then
  // notify.
  persistHasUnread(chatSessionId, true)
    .catch(() => {})
    .then(() => notifySessionsChanged());
}

/**
 * Dispatch the event to whichever pending tracker the session has.
 * Returns the empty↔non-empty transition so the caller can decide
 * whether to flip hasUnread and notify.
 */
function resolveGenerationDelta(chatSessionId: string, type: string, event: Record<string, unknown>): GenerationDelta {
  const session = store.get(chatSessionId);
  if (session) return applyEventToSession(session, type, event);
  if (type === EVENT_TYPES.generationStarted || type === EVENT_TYPES.generationFinished) {
    return updateStorelessPending(chatSessionId, type, event);
  }
  return "same";
}

function updateStorelessPending(chatSessionId: string, type: string, event: Record<string, unknown>): GenerationDelta {
  const payload = parseGenerationPayload(event);
  if (!payload) {
    log.warn("session-store", "malformed generation event", {
      chatSessionId,
      type,
    });
    return "same";
  }
  const mapKey = generationKey(payload.kind, payload.filePath, payload.key);
  const existing = storelessPending.get(chatSessionId);
  const wasEmpty = !existing || existing.size === 0;

  if (type === EVENT_TYPES.generationStarted) {
    const set = existing ?? new Set<string>();
    set.add(mapKey);
    if (!existing) storelessPending.set(chatSessionId, set);
  } else if (existing) {
    existing.delete(mapKey);
    if (existing.size === 0) storelessPending.delete(chatSessionId);
  }

  const isEmpty = (storelessPending.get(chatSessionId)?.size ?? 0) === 0;
  if (wasEmpty === isEmpty) return "same";
  return isEmpty ? "drained" : "started";
}

/**
 * How a generation event affected the session's pendingGenerations set:
 *
 * - `started`: empty → non-empty (first generation in a quiet session)
 * - `drained`: non-empty → empty (last pending generation finished)
 * - `same`: no transition (parallel starts/finishes within a burst,
 *   or a non-generation event type)
 *
 * Callers use this to decide whether to fire `notifySessionsChanged()`
 * and whether to flip hasUnread on drain.
 */
type GenerationDelta = "started" | "drained" | "same";

/** Fields pulled off a validated generation event. */
interface GenerationPayload {
  kind: GenerationKind;
  filePath: string;
  key: string;
}

const GENERATION_KIND_VALUES: ReadonlySet<string> = new Set(Object.values(GENERATION_KINDS));

function isGenerationKind(value: unknown): value is GenerationKind {
  return typeof value === "string" && GENERATION_KIND_VALUES.has(value);
}

/**
 * Narrow an event's generation fields at runtime. The event arrives
 * as `Record<string, unknown>` so we can't trust its shape — validate
 * every field before handing back a typed struct. Unknown kinds or
 * missing fields return null; the caller should log + no-op.
 */
function parseGenerationPayload(event: Record<string, unknown>): GenerationPayload | null {
  const { kind, filePath, key } = event;
  if (!isGenerationKind(kind)) return null;
  if (typeof filePath !== "string" || typeof key !== "string") return null;
  return { kind, filePath, key };
}

function applyEventToSession(session: ServerSession, type: string, event: Record<string, unknown>): GenerationDelta {
  if (type === EVENT_TYPES.toolCall) {
    session.toolCallHistory.push({
      toolUseId: event.toolUseId as string,
      toolName: event.toolName as string,
      args: event.args,
      timestamp: Date.now(),
    });
  } else if (type === EVENT_TYPES.toolCallResult) {
    const entry = session.toolCallHistory.find((historyEntry) => historyEntry.toolUseId === event.toolUseId);
    if (entry) entry.result = event.content as string;
  } else if (type === EVENT_TYPES.status) {
    session.statusMessage = event.message as string;
    // No notifySessionsChanged() here — status updates are high-frequency
    // and flow to subscribed clients via the session.<id> channel directly.
  } else if (type === EVENT_TYPES.generationStarted || type === EVENT_TYPES.generationFinished) {
    return updatePendingGenerations(session, type, event);
  }
  return "same";
}

function updatePendingGenerations(session: ServerSession, type: string, event: Record<string, unknown>): GenerationDelta {
  const payload = parseGenerationPayload(event);
  if (!payload) {
    log.warn("session-store", "malformed generation event", {
      chatSessionId: session.chatSessionId,
      type,
    });
    return "same";
  }
  const mapKey = generationKey(payload.kind, payload.filePath, payload.key);
  const wasEmpty = Object.keys(session.pendingGenerations).length === 0;

  if (type === EVENT_TYPES.generationStarted) {
    session.pendingGenerations[mapKey] = payload;
  } else {
    delete session.pendingGenerations[mapKey];
  }

  const isEmpty = Object.keys(session.pendingGenerations).length === 0;
  if (wasEmpty === isEmpty) return "same";
  return isEmpty ? "drained" : "started";
}

/**
 * Convenience wrapper for plugin routes that run long async jobs.
 * Publishes a generationStarted or generationFinished event on the
 * session channel. Safely no-ops when chatSessionId is missing — lets
 * callers that aren't inside a session context use the same routes.
 */
export function publishGeneration(
  chatSessionId: string | undefined,
  kind: GenerationKind,
  filePath: string,
  key: string,
  finished: boolean,
  error?: string,
): void {
  if (!chatSessionId) return;
  const event: Record<string, unknown> = {
    type: finished ? EVENT_TYPES.generationFinished : EVENT_TYPES.generationStarted,
    kind,
    filePath,
    key,
  };
  if (error) event.error = error;
  pushSessionEvent(chatSessionId, event);
}

export type PushToolResultOutcome = { kind: "skipped"; reason: string } | { kind: "processed" };

/** Persist a tool_result to JSONL, then publish to the session channel. */
export async function pushToolResult(chatSessionId: string, result: unknown): Promise<PushToolResultOutcome> {
  const session = store.get(chatSessionId);
  if (!session) return { kind: "skipped", reason: "unknown session" };

  await appendFile(
    session.resultsFilePath,
    JSON.stringify({
      source: "tool",
      type: EVENT_TYPES.toolResult,
      result,
    }) + "\n",
  );
  publishToSessionChannel(chatSessionId, {
    type: EVENT_TYPES.toolResult,
    result,
  });
  return { kind: "processed" };
}

// ── Query helpers ──────────────────────────────────────────────

export function getSessionImageData(chatSessionId: string): string | undefined {
  return store.get(chatSessionId)?.selectedImageData;
}

export function getActiveSessionIds(): Set<string> {
  const ids = new Set<string>();
  for (const [chatSessionId, session] of store) {
    if (session.isRunning) ids.add(chatSessionId);
  }
  return ids;
}

// ── In-process session event listeners ────────────────────────

type SessionEventListener = (event: Record<string, unknown>) => void;
const sessionListeners = new Map<string, Set<SessionEventListener>>();

/**
 * Subscribe to session events in-process (no WebSocket needed).
 * Returns an unsubscribe function.
 */
export function onSessionEvent(chatSessionId: string, listener: SessionEventListener): () => void {
  let listeners = sessionListeners.get(chatSessionId);
  if (!listeners) {
    listeners = new Set();
    sessionListeners.set(chatSessionId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners!.delete(listener);
    if (listeners!.size === 0) sessionListeners.delete(chatSessionId);
  };
}

// ── Internal helpers ───────────────────────────────────────────

async function persistHasUnread(chatSessionId: string, hasUnread: boolean): Promise<void> {
  try {
    await updateHasUnread(chatSessionId, hasUnread);
  } catch (err) {
    // updateHasUnread already no-ops when meta is missing (ENOENT is
    // handled internally). Any error reaching here is unexpected.
    log.warn("session-store", "persistHasUnread failed", {
      chatSessionId,
      hasUnread,
      error: String(err),
    });
  }
}

function publishToSessionChannel(chatSessionId: string, data: unknown): void {
  pubsub?.publish(sessionChannel(chatSessionId), data);
  const listeners = sessionListeners.get(chatSessionId);
  if (listeners) {
    for (const listener of listeners) {
      listener(data as Record<string, unknown>);
    }
  }
}

/** Notify all clients that session state has changed — refetch via REST. */
function notifySessionsChanged(): void {
  pubsub?.publish(PUBSUB_CHANNELS.sessions, {});
}

function evictIdleSessions(): void {
  const now = Date.now();
  for (const [chatSessionId, session] of store) {
    if (session.isRunning) continue;
    const age = now - new Date(session.updatedAt).getTime();
    if (age > IDLE_EVICTION_MS) {
      log.info("session-store", "evicting idle session", {
        chatSessionId,
      });
      removeSession(chatSessionId);
    }
  }
}

/**
 * Test-only: clear all in-memory state so a test suite can start
 * fresh without reloading the module.
 */
export function __resetForTests(): void {
  store.clear();
  storelessPending.clear();
  pubsub = null;
  if (evictionTimer) {
    clearInterval(evictionTimer);
    evictionTimer = null;
  }
}
