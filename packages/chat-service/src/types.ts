// @package-contract
//
// This module is designed to be extractable as a standalone npm
// package (e.g. `@mulmoclaude/chat-service`) at any time. To keep
// that path open, the rules are:
//
//  1. NO raw imports from `../` outside this directory — all host
//     dependencies MUST be passed through `ChatServiceDeps`.
//  2. Types declared here are STRUCTURAL duplicates of what the
//     host app uses. They look like the real `Role` / `Logger` /
//     `StartChatParams` types so the same functions plug in, but
//     they are defined here so the package has no compile-time
//     link back to the host.
//  3. When you add a new dependency, extend `ChatServiceDeps` and
//     thread it through the factory functions — do NOT reach out
//     to a module import. See #269 / #305 for the rationale.

export interface Role {
  id: string;
  name: string;
}

export interface Logger {
  error(prefix: string, message: string, data?: Record<string, unknown>): void;
  warn(prefix: string, message: string, data?: Record<string, unknown>): void;
  info(prefix: string, message: string, data?: Record<string, unknown>): void;
  debug(prefix: string, message: string, data?: Record<string, unknown>): void;
}

/** A file attached to a bridge or UI message. Generic enough for
 *  images, PDFs, documents, videos, etc. The server decides what to
 *  do with each based on mimeType — images become vision content
 *  blocks, unsupported types are ignored with a log.
 *
 *  Either `data` (inline base64 bytes) or `path` (workspace-relative
 *  path the server can read) MUST be set:
 *
 *    - Bridges over the socket transport ship raw bytes, so they
 *      populate `data` (and usually `mimeType`).
 *    - The Vue UI uploads paste/drop and sidebar-pick files to disk
 *      before sending and populates `path`; the server reads bytes
 *      from disk and infers `mimeType` from the extension.
 *
 *  Mirrors `@mulmobridge/protocol`'s `Attachment` (kept structurally
 *  duplicated here per the package-contract rules in this file). */
export interface Attachment {
  mimeType?: string;
  data?: string; // base64-encoded
  path?: string;
  filename?: string;
}

export interface StartChatParams {
  message: string;
  roleId: string;
  chatSessionId: string;
  /** Bridge-only legacy carrier for "the user picked this image".
   *  No in-tree bridge populates this today; the field stays on the
   *  type so external bridge clients on older protocol versions still
   *  type-check. Only workspace paths are accepted — `data:` URLs
   *  are no longer supported and the host app drops them with a
   *  warn. Bridges that need to ship raw bytes should use the
   *  modern `attachments[]` field with `{ mimeType, data }` entries;
   *  the host app persists those to `data/attachments/YYYY/MM/`
   *  server-side and rewrites them as path-bearing attachments
   *  before any other processing. */
  selectedImageData?: string;
  attachments?: Attachment[];
  /** Session origin — application-defined (e.g. "human", "bridge") */
  origin?: string;
  /** Flat primitive bag forwarded from the bridge handshake. Chat-
   *  service sanitises to string / number / boolean values only
   *  before this point — nested objects are dropped at the socket
   *  boundary so a downstream merge can't reintroduce prototype-
   *  pollution. The host app is free to look up its own keys
   *  (e.g. `defaultRole`). Empty object when the bridge didn't
   *  send any. */
  bridgeOptions?: Readonly<Record<string, string | number | boolean>>;
}

export type StartChatResult = { kind: "started"; chatSessionId: string } | { kind: "error"; error: string; status?: number };

export type StartChatFn = (params: StartChatParams) => Promise<StartChatResult>;

export type SessionEventListener = (event: Record<string, unknown>) => void;

export type OnSessionEventFn = (sessionId: string, listener: SessionEventListener) => () => void;

/** Summary of a chat session — returned by listSessions. */
export interface SessionSummary {
  id: string;
  roleId: string;
  preview: string;
  updatedAt: string;
}

export interface ChatServiceDeps {
  /** Relay a user turn into the agent loop. */
  startChat: StartChatFn;
  /** Subscribe to a session's event stream; returns an unsubscribe function. */
  onSessionEvent: OnSessionEventFn;
  /** All roles (built-in + custom). */
  loadAllRoles: () => Role[];
  /** Look up a single role by id; MUST fall back to default if unknown. */
  getRole: (roleId: string) => Role;
  /** Id used when a fresh transport chat has no role selected yet. */
  defaultRoleId: string;
  /** Absolute path to the transports workspace dir (one subdir per transportId). */
  transportsDir: string;
  logger: Logger;
  /**
   * Returns the current bearer token the socket transport should
   * accept at handshake, or null if auth isn't bootstrapped yet.
   * Omit in tests / unauth environments to skip the check. See
   * `attachChatSocket` in ./socket.ts.
   */
  tokenProvider?: () => string | null;
  /**
   * List recent sessions from the server. Used by /sessions command.
   * Omit if session listing is not available (command will reply
   * "not available").
   */
  listSessions?: (opts: { limit: number; offset: number }) => Promise<{ sessions: SessionSummary[]; total: number }>;
  /**
   * Get recent messages from a session. Used by /history command.
   * Returns newest-first array of {source, text} pairs.
   */
  getSessionHistory?: (
    sessionId: string,
    opts: { limit: number; offset: number },
  ) => Promise<{
    messages: Array<{ source: string; text: string }>;
    total: number;
  }>;
  /**
   * Return the skills the bridge command handler should expose. The
   * handler uses the result for two things:
   *   (1) Decide whether an unknown bridge slash command (e.g. `/foo`
   *       from Telegram) names a registered skill — only matching
   *       names are forwarded to the agent so the Claude CLI's
   *       slash-command resolver runs the skill. Non-matches stay a
   *       transport-level "Unknown command" reply.
   *   (2) Render a "Skills:" section in the bridge `/help` text and
   *       in the "Unknown command" fallback so a bridge user can
   *       discover what skills exist without leaving the chat.
   * When omitted, every unknown slash is rejected and `/help` shows
   * only the built-in commands.
   */
  listRegisteredSkills?: () => Promise<BridgeSkillSummary[]>;
}

/** Minimal skill info the bridge command handler needs to render the
 *  `/help` text and decide whether a slash command should be forwarded
 *  to the agent. Sourced from SKILL.md frontmatter on the host side. */
export interface BridgeSkillSummary {
  name: string;
  description: string;
}
