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

export interface StartChatParams {
  message: string;
  roleId: string;
  chatSessionId: string;
  selectedImageData?: string;
}

export type StartChatResult =
  | { kind: "started"; chatSessionId: string }
  | { kind: "error"; error: string; status?: number };

export type StartChatFn = (params: StartChatParams) => Promise<StartChatResult>;

export type SessionEventListener = (event: Record<string, unknown>) => void;

export type OnSessionEventFn = (
  sessionId: string,
  listener: SessionEventListener,
) => () => void;

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
}
