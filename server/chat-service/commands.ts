import { getRole, loadAllRoles } from "../roles.js";
import type { TransportChatState } from "./chat-state.js";
import { resetChatState } from "./chat-state.js";

// ── Types ────────────────────────────────────────────────────

export interface CommandResult {
  reply: string;
  nextState?: TransportChatState;
}

// ── Command handler ──────────────────────────────────────────

/**
 * Parse and execute a slash command.
 * Returns null if the text is not a command (doesn't start with `/`).
 */
export async function handleCommand(
  text: string,
  transportId: string,
  chatState: TransportChatState,
): Promise<CommandResult | null> {
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
}

// ── Individual commands ──────────────────────────────────────

async function handleReset(
  transportId: string,
  chatState: TransportChatState,
): Promise<CommandResult> {
  const nextState = await resetChatState(
    transportId,
    chatState.externalChatId,
    chatState.roleId,
  );
  return {
    reply: `Session reset. Role: ${nextState.roleId}`,
    nextState,
  };
}

async function handleRole(
  transportId: string,
  chatState: TransportChatState,
  requestedRoleId: string | undefined,
): Promise<CommandResult> {
  if (!requestedRoleId) {
    return { reply: `Usage: /role <id>\n\n${getRolesText()}` };
  }

  const allRoles = loadAllRoles();
  const role = allRoles.find((r) => r.id === requestedRoleId);
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
}

function handleStatus(chatState: TransportChatState): CommandResult {
  const role = getRole(chatState.roleId);
  return {
    reply: [
      `Role: ${role.name} (${role.id})`,
      `Session: ${chatState.sessionId}`,
      `Last activity: ${chatState.updatedAt}`,
    ].join("\n"),
  };
}

// ── Helpers ──────────────────────────────────────────────────

function getHelpText(): string {
  return [
    "Commands:",
    "  /reset  — Start a new session",
    "  /help   — Show this help",
    "  /roles  — List available roles",
    "  /role <id> — Switch role",
    "  /status — Show current session info",
    "",
    "Send any other text to chat with the assistant.",
  ].join("\n");
}

function getRolesText(): string {
  return [
    "Available roles:",
    ...loadAllRoles().map((r) => `  ${r.id} — ${r.name}`),
  ].join("\n");
}
