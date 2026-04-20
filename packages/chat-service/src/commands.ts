// @package-contract — see ./types.ts
//
// Parses and executes slash commands (/reset, /help, /roles, /role,
// /status) for the transport chat bridge. Role lookups and state
// reset arrive via the factory so this file has zero imports from
// the host app — only sibling module types.

import type { Role, SessionSummary } from "./types.js";
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

// Mirror server/utils/time.ts names but declared locally since
// the chat-service package must not import from the host app.
const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / ONE_MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(diffMs / ONE_HOUR_MS);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diffMs / ONE_DAY_MS);
  return `${days}d ago`;
}

// ── Factory ──────────────────────────────────────────────────

export function createCommandHandler(opts: {
  loadAllRoles: () => Role[];
  getRole: (roleId: string) => Role;
  resetChatState: ChatStateStore["resetChatState"];
  connectSession: ChatStateStore["connectSession"];
  listSessions?: () => Promise<SessionSummary[]>;
}): CommandHandler {
  const {
    loadAllRoles,
    getRole,
    resetChatState,
    connectSession,
    listSessions,
  } = opts;

  // Cache the last /sessions result so /switch <number> can reference it.
  let lastSessionList: SessionSummary[] = [];

  const getRolesText = (): string =>
    [
      "Available roles:",
      ...loadAllRoles().map((r) => `  ${r.id} — ${r.name}`),
    ].join("\n");

  const getHelpText = (): string =>
    [
      "Commands:",
      "  /reset  — Start a new session",
      "  /sessions [page] — List recent sessions (e.g. /sessions 2)",
      "  /switch <number> — Switch to a session from the list",
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

  const PAGE_SIZE = 10;

  const handleSessions = async (
    pageArg: string | undefined,
  ): Promise<CommandResult> => {
    if (!listSessions) {
      return { reply: "Session listing is not available." };
    }
    const sessions = await listSessions();
    if (sessions.length === 0) {
      return { reply: "No sessions found." };
    }
    lastSessionList = sessions;
    const page = Math.max(1, parseInt(pageArg ?? "1", 10) || 1);
    const start = (page - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, sessions.length);
    if (start >= sessions.length) {
      return { reply: `No more sessions. Total: ${sessions.length}` };
    }
    const lines = sessions.slice(start, end).map((s, i) => {
      const num = start + i + 1;
      const preview =
        s.preview.length > 40 ? s.preview.slice(0, 40) + "..." : s.preview;
      return `  ${num}. [${s.roleId}] ${preview || "(no title)"} — ${formatRelativeTime(s.updatedAt)}`;
    });
    const totalPages = Math.ceil(sessions.length / PAGE_SIZE);
    const header = `Sessions (page ${page}/${totalPages}, total ${sessions.length}):`;
    const parts = [header, ...lines];
    if (page < totalPages) {
      parts.push(`\n/sessions ${page + 1} for next page`);
    }
    parts.push("Use /switch <number> to connect.");
    return { reply: parts.join("\n") };
  };

  const handleSwitch = async (
    transportId: string,
    chatState: TransportChatState,
    arg: string | undefined,
  ): Promise<CommandResult> => {
    if (!arg) {
      return {
        reply: "Usage: /switch <number>\nRun /sessions first to see the list.",
      };
    }
    const index = parseInt(arg, 10);
    if (
      !Number.isInteger(index) ||
      index < 1 ||
      index > lastSessionList.length
    ) {
      return {
        reply:
          lastSessionList.length > 0
            ? `Invalid number. Pick 1-${lastSessionList.length} from the /sessions list.`
            : "Run /sessions first to see available sessions.",
      };
    }
    const target = lastSessionList[index - 1];
    const updated = await connectSession(
      transportId,
      chatState.externalChatId,
      target.id,
    );
    if (!updated) {
      return { reply: "Failed to switch session." };
    }
    const role = getRole(target.roleId);
    const preview = target.preview || "(no title)";
    return {
      reply: `Connected to "${preview}" (${role.name}). Send a message to continue.`,
      nextState: updated,
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
      case "/sessions":
        return handleSessions(args[0]);
      case "/switch":
        return handleSwitch(transportId, chatState, args[0]);
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
