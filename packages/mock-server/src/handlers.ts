import type { MockServerOptions } from "./server.js";

export interface AttachmentPayload {
  mimeType: string;
  data: string;
  filename?: string;
}

export interface MessagePayload {
  externalChatId: string;
  text: string;
  attachments?: AttachmentPayload[];
}

export interface MessageAck {
  ok: boolean;
  reply?: string;
  error?: string;
  status?: number;
}

// ── Slash commands ────────────────────────────────────────────────

const HELP_TEXT = `Available commands:
  /reset  — Start a new session
  /help   — Show this help
  /roles  — List available roles
  /role <id> — Switch role
  /status — Show current session info

Send any other text to chat with the assistant.`;

const ROLES_TEXT = `Available roles:
  general — General Assistant
  office — Office Guide & Tutor
  artist — Artist`;

function handleSlashCommand(text: string, payload: MessagePayload): MessageAck | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [command, ...args] = trimmed.split(/\s+/);

  switch (command) {
    case "/help":
      return { ok: true, reply: HELP_TEXT };
    case "/reset":
      return { ok: true, reply: "Session reset. Role: general" };
    case "/roles":
      return { ok: true, reply: ROLES_TEXT };
    case "/role": {
      const roleId = args[0] ?? "general";
      return {
        ok: true,
        reply: `Switched to ${roleId}. New session started.`,
      };
    }
    case "/status":
      return {
        ok: true,
        reply: `Role: general\nSession: mock-${payload.externalChatId}\nLast activity: ${new Date().toISOString()}`,
      };
    default:
      return {
        ok: true,
        reply: `Unknown command: ${command}\n\n${HELP_TEXT}`,
      };
  }
}

// ── Echo reply ────────────────────────────────────────────────────

function buildEchoReply(payload: MessagePayload): string {
  const parts: string[] = [`[echo] ${payload.text}`];

  if (payload.attachments && payload.attachments.length > 0) {
    for (const att of payload.attachments) {
      const sizeBytes = Math.ceil((att.data.length * 3) / 4);
      const name = att.filename ? ` ${att.filename}` : "";
      parts.push(`[attachment: ${att.mimeType} ${sizeBytes}B${name}]`);
    }
  }

  return parts.join("\n");
}

// ── Public ────────────────────────────────────────────────────────

export function handleMessage(payload: MessagePayload, opts: MockServerOptions): MessageAck {
  if (opts.alwaysError) {
    return { ok: false, error: "simulated error", status: 500 };
  }

  const text = payload.text ?? "";

  // Slash commands first
  const cmdResult = handleSlashCommand(text, payload);
  if (cmdResult) return cmdResult;

  // Echo mode
  return { ok: true, reply: buildEchoReply(payload) };
}
