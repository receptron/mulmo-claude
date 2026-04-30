// Convert an in-memory chat session (a sequence of ToolResultComplete
// items + per-uuid timestamps) into a self-contained Markdown document
// suitable for pasting into a doc, an issue, or another chat.
//
// Design (Option A — blockquoted turns):
//   Each speaker turn is rendered as `### 👤 Speaker · HH:MM` followed
//   by the message body prefixed line-by-line with `> `. The blockquote
//   guarantees that any markdown the message itself contains (headings,
//   tables, code fences, raw HTML) renders inside a visually distinct
//   quote region rather than colliding with the export's own structure.
//
// Tool calls (anything other than `text-response`) are rendered as a
// single italic line `*🔧 toolName — title*`, outside the blockquote.
// Their full payloads are intentionally omitted to keep the export
// readable; users wanting fidelity can view the raw JSONL.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { isRecord } from "../types";

const TEXT_RESPONSE_TOOL = "text-response";

const ROLE_LABELS = {
  user: "👤 You",
  assistant: "🤖 Assistant",
  system: "⚙️ System",
} as const;

type Role = keyof typeof ROLE_LABELS;

export interface ExportChatOptions {
  /** Friendly role / persona name shown in the document title (e.g. "General"). */
  sessionRoleName?: string;
  /** ISO string for the document's "Exported …" line. Defaults to `new Date()`. */
  exportedAt?: string;
  /** Per-uuid epoch-ms map matching `ActiveSession.resultTimestamps`. */
  resultTimestamps?: Map<string, number>;
}

/** Format `epochMs` as `HH:MM` in 24h, locale-independent. */
function formatHHMM(epochMs: number): string {
  const date = new Date(epochMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Prefix every line with `> `. Empty lines become bare `>` so the quote
 *  block stays contiguous (CommonMark breaks the quote on a fully blank line). */
function blockquote(text: string): string {
  if (text.length === 0) return ">";
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

/** Narrow `data?.role` to a known speaker label. Defaults to "assistant". */
function roleOf(result: ToolResultComplete): Role {
  const { data } = result;
  if (isRecord(data) && typeof data.role === "string" && data.role in ROLE_LABELS) {
    return data.role as Role;
  }
  return "assistant";
}

/** Pull the displayable text from a text-response result. Falls back to
 *  `message` for older/saved sessions where `data.text` may be missing. */
function textOf(result: ToolResultComplete): string {
  const { data } = result;
  if (isRecord(data) && typeof data.text === "string") return data.text;
  return result.message ?? "";
}

function isTextResponse(result: ToolResultComplete): boolean {
  return result.toolName === TEXT_RESPONSE_TOOL;
}

function renderTextTurn(result: ToolResultComplete, timestamps: Map<string, number>): string {
  const role = roleOf(result);
  const epochMs = timestamps.get(result.uuid);
  const time = epochMs ? ` · ${formatHHMM(epochMs)}` : "";
  const body = textOf(result).trim();
  return `### ${ROLE_LABELS[role]}${time}\n${blockquote(body)}`;
}

function renderToolTurn(result: ToolResultComplete, timestamps: Map<string, number>): string {
  const epochMs = timestamps.get(result.uuid);
  const time = epochMs ? ` · ${formatHHMM(epochMs)}` : "";
  const label = result.title?.trim() ? `${result.toolName} — ${result.title.trim()}` : result.toolName;
  return `*🔧 ${label}${time}*`;
}

/** Build the document header. Title and the "Exported" subtitle are
 *  intentionally plain — the conversation body is what the reader cares
 *  about. The horizontal rule separates header from first turn. */
function renderHeader(opts: ExportChatOptions): string {
  const role = opts.sessionRoleName?.trim();
  const exportedAt = new Date(opts.exportedAt ?? new Date().toISOString());
  const dateStamp = exportedAt.toISOString().slice(0, 16).replace("T", " ");
  const title = role ? `# Conversation · ${role}` : "# Conversation";
  return `${title}\n\n*Exported ${dateStamp} UTC*\n\n---`;
}

/** Convert a chat session to a Markdown string. Pure function; safe to
 *  call from anywhere. Returns at minimum a non-empty header so callers
 *  never have to special-case empty sessions. */
export function exportChatToMarkdown(results: readonly ToolResultComplete[], options: ExportChatOptions = {}): string {
  const timestamps = options.resultTimestamps ?? new Map<string, number>();
  const turns = results.map((result) => (isTextResponse(result) ? renderTextTurn(result, timestamps) : renderToolTurn(result, timestamps)));
  const body = turns.join("\n\n---\n\n");
  const header = renderHeader(options);
  return body.length > 0 ? `${header}\n\n${body}\n` : `${header}\n`;
}
