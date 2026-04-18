// @package-contract — see ./types.ts
//
// Parses and executes slash commands (/reset, /help, /roles, /role,
// /status) for the transport chat bridge. Role lookups and state
// reset arrive via the factory so this file has zero imports from
// the host app — only sibling module types.

import type { Role } from "./types.js";
import type { ChatStateStore, TransportChatState } from "./chat-state.js";

// ── Types ────────────────────────────────────────────────────

export interface CommandResult {
  reply: string;
  nextState?: TransportChatState;
}

export type CommandHandler = (
  text: string,
  transportId: string,
  chatState: TransportChatState,
) => Promise<CommandResult | null>;

// ── Factory ──────────────────────────────────────────────────

export function createCommandHandler(opts: {
  loadAllRoles: () => Role[];
  getRole: (roleId: string) => Role;
  resetChatState: ChatStateStore["resetChatState"];
}): CommandHandler {
  const { loadAllRoles, getRole, resetChatState } = opts;

  const getRolesText = (): string =>
    [
      "Available roles:",
      ...loadAllRoles().map((r) => `  ${r.id} — ${r.name}`),
    ].join("\n");

  const getHelpText = (): string =>
    [
      "Commands:",
      "  /reset  — Start a new session",
      "  /help   — Show this help",
      "  /roles  — List available roles",
      "  /role <id> — Switch role",
      "  /status — Show current session info",
      "",
      "Send any other text to chat with the assistant.",
    ].join("\n");

  const handleReset = async (
    transportId: string,
    chatState: TransportChatState,
  ): Promise<CommandResult> => {
    const nextState = await resetChatState(
      transportId,
      chatState.externalChatId,
      chatState.roleId,
    );
    return {
      reply: `Session reset. Role: ${nextState.roleId}`,
      nextState,
    };
  };

  const handleRole = async (
    transportId: string,
    chatState: TransportChatState,
    requestedRoleId: string | undefined,
  ): Promise<CommandResult> => {
    if (!requestedRoleId) {
      return { reply: `Usage: /role <id>\n\n${getRolesText()}` };
    }
    const role = loadAllRoles().find((r) => r.id === requestedRoleId);
    if (!role) {
      return { reply: `Unknown role: ${requestedRoleId}\n\n${getRolesText()}` };
    }
    const nextState = await resetChatState(
      transportId,
      chatState.externalChatId,
      role.id,
    );
    return {
      reply: `Switched to ${role.name} (${role.id}). New session started.`,
      nextState,
    };
  };

  const handleStatus = (chatState: TransportChatState): CommandResult => {
    const role = getRole(chatState.roleId);
    return {
      reply: [
        `Role: ${role.name} (${role.id})`,
        `Session: ${chatState.sessionId}`,
        `Last activity: ${chatState.updatedAt}`,
      ].join("\n"),
    };
  };

  const handleCommand: CommandHandler = async (
    text,
    transportId,
    chatState,
  ) => {
    if (!text.startsWith("/")) return null;
    const [command, ...args] = text.split(/\s+/);

    switch (command) {
      case "/reset":
        return handleReset(transportId, chatState);
      case "/help":
        return { reply: getHelpText() };
      case "/roles":
        return { reply: getRolesText() };
      case "/role":
        return handleRole(transportId, chatState, args[0]);
      case "/status":
        return handleStatus(chatState);
      default:
        return { reply: `Unknown command: ${command}\n\n${getHelpText()}` };
    }
  };

  return handleCommand;
}
