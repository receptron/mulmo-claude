// @package-contract — see ./types.ts
//
// Parses and executes slash commands (/reset, /help, /roles, /role,
// /status) for the transport chat bridge. Role lookups and state
// reset arrive via the factory so this file has zero imports from
// the host app — only sibling module types.

import type { BridgeSkillSummary, Role, SessionSummary } from "./types.js";
import type { ChatStateStore, TransportChatState } from "./chat-state.js";

// ── Types ────────────────────────────────────────────────────

export interface CommandResult {
  reply: string;
  nextState?: TransportChatState;
  /** When set, the relay must NOT short-circuit with `reply`. It
   *  adopts `nextState` as the active chat state and forwards
   *  `forwardAs` to the agent as the user message. Used by the
   *  `//{skill}` shortcut: reset + run skill in one bridge turn. */
  forwardAs?: string;
}

export type CommandHandler = (text: string, transportId: string, chatState: TransportChatState) => Promise<CommandResult | null>;

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
  listSessions?: (opts: { limit: number; offset: number }) => Promise<{ sessions: SessionSummary[]; total: number }>;
  getSessionHistory?: (
    sessionId: string,
    opts: { limit: number; offset: number },
  ) => Promise<{
    messages: Array<{ source: string; text: string }>;
    total: number;
  }>;
  /** Lists the skills the bridge command handler should expose.
   *  Drives both the slash-command allowlist (only matching names
   *  are forwarded to the agent) and the "Skills:" section in the
   *  `/help` reply. When omitted, every unknown slash is rejected
   *  and `/help` shows only the built-in commands. */
  listRegisteredSkills?: () => Promise<BridgeSkillSummary[]>;
}): CommandHandler {
  const { loadAllRoles, getRole, resetChatState, connectSession, listSessions, getSessionHistory, listRegisteredSkills } = opts;

  // Cache /sessions results per chat so /switch resolves to the correct list.
  // Key: "transportId:externalChatId". Bounded with max entries + TTL.
  // See docs/bridge-session-design.md for multi-user scaling plan.
  const MAX_CACHE_ENTRIES = 1000;
  const CACHE_TTL_MS = 5 * ONE_MINUTE_MS;

  interface CacheEntry {
    sessions: SessionSummary[];
    createdAt: number;
  }
  const sessionListCache = new Map<string, CacheEntry>();
  const cacheKey = (transportId: string, externalChatId: string) => `${transportId}:${externalChatId}`;

  function getCachedSessions(key: string): SessionSummary[] | null {
    const entry = sessionListCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
      sessionListCache.delete(key);
      return null;
    }
    return entry.sessions;
  }

  function setCachedSessions(key: string, sessions: SessionSummary[]): void {
    if (sessionListCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = sessionListCache.keys().next().value;
      if (oldest !== undefined) sessionListCache.delete(oldest);
    }
    sessionListCache.set(key, { sessions, createdAt: Date.now() });
  }

  const getRolesText = (): string => ["Available roles:", ...loadAllRoles().map((r) => `  ${r.id} — ${r.name}`)].join("\n");

  // Built each time so `/help` reflects the live skill list. The
  // `skills` argument is fetched once per command turn (see the
  // `default:` branch and `case "/help"`) so we don't fs-scan twice
  // when the handler both checks membership and renders help.
  const buildHelpText = (skills: BridgeSkillSummary[]): string => {
    const lines = [
      "Commands:",
      "  /reset  — Start a new session",
      "  /sessions [page] — List recent sessions (e.g. /sessions 2)",
      "  /switch <number|sessionId> — Switch to a session",
      "  /history [page] — Show recent messages in current session",
      "  /help   — Show this help",
      "  /roles  — List available roles",
      "  /role <id> — Switch role",
      "  /status — Show current session info",
    ];
    if (skills.length > 0) {
      lines.push("", "Skills:", ...skills.map((s) => `  /${s.name} — ${s.description}`));
      lines.push("", "Tip: //<skill> [args...] starts a fresh session and runs the skill in one shot.");
    }
    lines.push("", "Send any other text to chat with the assistant.");
    return lines.join("\n");
  };

  const fetchSkills = async (): Promise<BridgeSkillSummary[]> => (listRegisteredSkills ? await listRegisteredSkills() : []);

  const handleReset = async (transportId: string, chatState: TransportChatState): Promise<CommandResult> => {
    const nextState = await resetChatState(transportId, chatState.externalChatId, chatState.roleId);
    return {
      reply: `Session reset. Role: ${nextState.roleId}`,
      nextState,
    };
  };

  const handleRole = async (transportId: string, chatState: TransportChatState, requestedRoleId: string | undefined): Promise<CommandResult> => {
    if (!requestedRoleId) {
      return { reply: `Usage: /role <id>\n\n${getRolesText()}` };
    }
    const role = loadAllRoles().find((r) => r.id === requestedRoleId);
    if (!role) {
      return { reply: `Unknown role: ${requestedRoleId}\n\n${getRolesText()}` };
    }
    const nextState = await resetChatState(transportId, chatState.externalChatId, role.id);
    return {
      reply: `Switched to ${role.name} (${role.id}). New session started.`,
      nextState,
    };
  };

  const handleStatus = (chatState: TransportChatState): CommandResult => {
    const role = getRole(chatState.roleId);
    return {
      reply: [`Role: ${role.name} (${role.id})`, `Session: ${chatState.sessionId}`, `Last activity: ${chatState.updatedAt}`].join("\n"),
    };
  };

  const SESSIONS_PAGE_SIZE = 10;

  const handleSessions = async (transportId: string, chatState: TransportChatState, pageArg: string | undefined): Promise<CommandResult> => {
    if (!listSessions) {
      return { reply: "Session listing is not available." };
    }
    const page = Math.max(1, parseInt(pageArg ?? "1", 10) || 1);
    const offset = (page - 1) * SESSIONS_PAGE_SIZE;
    const { sessions, total } = await listSessions({
      limit: SESSIONS_PAGE_SIZE,
      offset,
    });
    if (sessions.length === 0 && total === 0) {
      return { reply: "No sessions found." };
    }
    if (sessions.length === 0) {
      return { reply: `No more sessions. Total: ${total}` };
    }
    // Cache full page for /switch (keyed by offset so numbers are absolute)
    const key = cacheKey(transportId, chatState.externalChatId);
    const existing = getCachedSessions(key) ?? [];
    // Merge into cache at correct positions
    const merged = [...existing];
    sessions.forEach((s, i) => {
      merged[offset + i] = s;
    });
    setCachedSessions(key, merged);

    const totalPages = Math.ceil(total / SESSIONS_PAGE_SIZE);
    const lines = sessions.map((s, i) => {
      const num = offset + i + 1;
      const preview = s.preview.length > 40 ? s.preview.slice(0, 40) + "..." : s.preview;
      return `  ${num}. [${s.roleId}] ${preview || "(no title)"} — ${formatRelativeTime(s.updatedAt)}`;
    });
    const header = `Sessions (page ${page}/${totalPages}, total ${total}):`;
    const parts = [header, ...lines];
    if (page < totalPages) {
      parts.push(`\n/sessions ${page + 1} for next page`);
    }
    parts.push("Use /switch <number> or /switch <sessionId> to connect.");
    return { reply: parts.join("\n") };
  };

  const handleSwitch = async (transportId: string, chatState: TransportChatState, arg: string | undefined): Promise<CommandResult> => {
    if (!arg) {
      return {
        reply: "Usage: /switch <number|sessionId>\nRun /sessions first to see the list.",
      };
    }
    const key = cacheKey(transportId, chatState.externalChatId);
    const cached = getCachedSessions(key) ?? [];
    let target: SessionSummary | undefined;
    if (/^\d+$/.test(arg)) {
      // Numeric — index into cached list
      const index = parseInt(arg, 10);
      if (index < 1 || index > cached.length) {
        return {
          reply: cached.length > 0 ? `Invalid number. Pick 1-${cached.length} from the /sessions list.` : "Run /sessions first to see available sessions.",
        };
      }
      target = cached[index - 1];
      // Guard against sparse cache (user loaded page 2 but not page 1)
      if (!target) {
        const page = Math.ceil(index / SESSIONS_PAGE_SIZE);
        return {
          reply: `Run /sessions ${page} first to load that page.`,
        };
      }
    } else {
      // Non-numeric — treat as session ID
      target = cached.find((s) => s.id === arg);
      if (!target) {
        return {
          reply: `Session "${arg}" not found. Run /sessions to see available sessions.`,
        };
      }
    }
    const updated = await connectSession(transportId, chatState.externalChatId, target.id);
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

  const HISTORY_PAGE_SIZE = 5;
  const MAX_MESSAGE_LENGTH = 200;

  const handleHistory = async (chatState: TransportChatState, pageArg: string | undefined): Promise<CommandResult> => {
    if (!getSessionHistory) {
      return { reply: "History is not available." };
    }
    const page = Math.max(1, parseInt(pageArg ?? "1", 10) || 1);
    const offset = (page - 1) * HISTORY_PAGE_SIZE;
    const { messages, total } = await getSessionHistory(chatState.sessionId, {
      limit: HISTORY_PAGE_SIZE,
      offset,
    });
    if (messages.length === 0 && total === 0) {
      return { reply: "No messages in this session." };
    }
    if (messages.length === 0) {
      return { reply: `No more messages. Total: ${total}` };
    }
    const totalPages = Math.ceil(total / HISTORY_PAGE_SIZE);
    const lines = messages.map((m) => {
      const label = m.source === "user" ? "You" : "AI";
      const text = m.text.length > MAX_MESSAGE_LENGTH ? m.text.slice(0, MAX_MESSAGE_LENGTH) + "..." : m.text;
      return `[${label}] ${text}`;
    });
    const header = `History (page ${page}/${totalPages}):`;
    const parts = [header, "", ...lines];
    if (page < totalPages) {
      parts.push(`\n/history ${page + 1} for older messages`);
    }
    return { reply: parts.join("\n\n") };
  };

  const handleCommand: CommandHandler = async (text, transportId, chatState) => {
    if (!text.startsWith("/")) return null;

    // `//{skill} [args...]` shortcut — start a new session AND run
    // the skill in one bridge turn. Args after the skill name are
    // forwarded verbatim, so `//mag2 https://x.com/post` resets and
    // runs `/mag2 https://x.com/post`.
    if (text.startsWith("//")) {
      const skills = await fetchSkills();
      const [head, ...rest] = text.split(/\s+/);
      const skillName = head.slice(2);
      if (skillName && skills.some((s) => s.name === skillName)) {
        const nextState = await resetChatState(transportId, chatState.externalChatId, chatState.roleId);
        const forwardAs = rest.length > 0 ? `/${skillName} ${rest.join(" ")}` : `/${skillName}`;
        return {
          reply: `Session reset. Running ${forwardAs}`,
          nextState,
          forwardAs,
        };
      }
      return { reply: `Unknown command: ${text}\n\n${buildHelpText(skills)}` };
    }

    const [command, ...args] = text.split(/\s+/);

    switch (command) {
      case "/reset":
        return handleReset(transportId, chatState);
      case "/sessions":
        return handleSessions(transportId, chatState, args[0]);
      case "/switch":
        return handleSwitch(transportId, chatState, args[0]);
      case "/history":
        return handleHistory(chatState, args[0]);
      case "/help":
        return { reply: buildHelpText(await fetchSkills()) };
      case "/roles":
        return { reply: getRolesText() };
      case "/role":
        return handleRole(transportId, chatState, args[0]);
      case "/status":
        return handleStatus(chatState);
      default: {
        // Forward to the agent only if the command names a registered
        // skill; otherwise reply with the standard "Unknown command"
        // help. We deliberately do NOT pass arbitrary slash text
        // through, so a typo can't accidentally invoke the agent and
        // a slash that doesn't match anything stays a transport-level
        // error. Reuse the same skill list for the membership check
        // and the help text to avoid scanning the skills dir twice.
        const skills = await fetchSkills();
        const skillName = command.slice(1);
        if (skillName && skills.some((s) => s.name === skillName)) return null;
        return { reply: `Unknown command: ${command}\n\n${buildHelpText(skills)}` };
      }
    }
  };

  return handleCommand;
}
