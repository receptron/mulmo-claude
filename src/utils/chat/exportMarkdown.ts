// Convert an in-memory chat session (a sequence of ToolResultComplete
// items + per-uuid timestamps) into a self-contained Markdown document
// suitable for pasting into a doc, an issue, or another chat.
//
// Each turn is rendered as a `## ⬜︎ Speaker · HH:MM` heading followed
// by the message body, with `---` horizontal rules between turns.
// Headings inside message bodies are demoted by 2 levels (e.g. an
// assistant `# Heading` becomes `### Heading`) so the speaker headings
// always sit above message-internal structure in the document outline.
//
// Tool calls (anything other than `text-response`) render as a `## ⬛︎
// toolName HH:MM` heading — a compact marker showing which tools the
// assistant invoked. Tool payloads are intentionally omitted to keep
// the export readable; users wanting fidelity can view the raw JSONL.
// The one exception is `presentDocument`: its `data.markdown` is
// itself a piece of prose worth reading out of context, so we inline
// the document body (demoted by 2 levels) under the marker. In real
// sessions `data.markdown` is usually a workspace path
// (`artifacts/documents/*.md`) rather than inline text, so the export
// is async — callers pass a `readFile` resolver that reads the file
// off the workspace, mirroring the in-app Markdown View's loader.

import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { isRecord } from "../types";

const TEXT_RESPONSE_TOOL = "text-response";
const PRESENT_DOCUMENT_TOOL = "presentDocument";

/** Heuristic for the file-path mode of presentDocument's `markdown` field
 *  (server-side documents stored under `artifacts/documents/*.md`). When
 *  matched, the value is a path — not inline content — and the export
 *  has to read the file off the workspace via the caller-supplied
 *  resolver to inline the body. */
function looksLikeDocumentPath(value: string): boolean {
  return value.endsWith(".md") && value.startsWith("artifacts/documents/");
}

const ROLE_LABELS = {
  user: "⬜︎ You",
  assistant: "⬛︎ Assistant",
  system: "◇ System",
} as const;

type Role = keyof typeof ROLE_LABELS;

export interface ExportChatOptions {
  /** Friendly role / persona name shown in the document title (e.g. "General"). */
  sessionRoleName?: string;
  /** ISO string for the document's "Exported …" line. Defaults to `new Date()`. */
  exportedAt?: string;
  /** Per-uuid epoch-ms map matching `ActiveSession.resultTimestamps`. */
  resultTimestamps?: Map<string, number>;
  /** Resolver for workspace-relative file paths (currently the
   *  `artifacts/documents/*.md` form used by presentDocument). Returns
   *  the file's text content, or null if the read fails. Omit it to
   *  skip file-mode resolution and emit only the marker line. */
  readFile?: (path: string) => Promise<string | null>;
}

/** Format `epochMs` as `HH:MM` in 24h, locale-independent. */
function formatHHMM(epochMs: number): string {
  const date = new Date(epochMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Narrow `data?.role` to a known speaker label. Defaults to "assistant". */
function roleOf(result: ToolResultComplete): Role {
  const { data } = result;
  // Own-property check via Object.prototype.hasOwnProperty so an
  // inherited key on the runtime ROLE_LABELS object (e.g. `toString`,
  // or anything that crawled in via Object.prototype pollution)
  // can't satisfy the gate and produce a `## undefined` speaker line
  // (#1065 review).
  if (isRecord(data) && typeof data.role === "string" && Object.prototype.hasOwnProperty.call(ROLE_LABELS, data.role)) {
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

// Allow up to 3 leading spaces before the fence run, per GFM. A
// 4-space indent is a regular indented code block and isn't a fence
// in the first place; the heading-demotion path doesn't need to skip
// inside those because they preserve the literal characters anyway,
// but a real fence indented by 1-3 spaces (legal GFM) would
// previously slip past `matchFenceRun` and any `# heading` line
// inside got mistakenly demoted (#1065 review).
const FENCE_RUN_RE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_HEADING_RE = /^(#{1,6})([ \t].*)$/;

interface OpenFence {
  char: "`" | "~";
  len: number;
}

/** Match the leading run of fence characters on `line` (allowing up
 *  to 3 leading spaces, per GFM), if any. Captures the fence char +
 *  length so the closing logic can apply GFM's rules (close fence
 *  must be the same char and at least as long as the open). */
function matchFenceRun(line: string): OpenFence | null {
  const match = FENCE_RUN_RE.exec(line);
  if (!match) return null;
  const [, run] = match;
  return { char: run[0] as "`" | "~", len: run.length };
}

/** A line closes `open` only when it uses the same fence char, has at
 *  least as many of them, and carries no info-string after the run.
 *  Anything else inside the fence is content (including a different
 *  fence type or a shorter run). The fence run can sit after up to
 *  3 leading spaces; the closing check looks at content after the
 *  fence run wherever it lands on the line. */
function isClosingFence(line: string, fence: OpenFence, open: OpenFence): boolean {
  if (fence.char !== open.char) return false;
  if (fence.len < open.len) return false;
  const runStart = line.search(/[`~]/);
  return runStart >= 0 ? line.slice(runStart + fence.len).trim() === "" : false;
}

/** Demote every ATX heading inside `markdown` by `levels` (`#` → `#`+levels),
 *  capping at h6. Skips lines inside fenced code blocks so `# comment`
 *  lines in code samples are left alone. Honours GFM fence rules: a
 *  block opened with N backticks (or N tildes) only closes on a line of
 *  the same character with ≥N of them and nothing else, so nested
 *  shorter fences and the opposite fence char both count as content. */
function demoteHeadings(markdown: string, levels: number): string {
  if (levels <= 0 || markdown.length === 0) return markdown;
  const out: string[] = [];
  let openFence: OpenFence | null = null;
  for (const line of markdown.split(/\r\n|\r|\n/)) {
    const fence = matchFenceRun(line);
    if (openFence !== null) {
      if (fence !== null && isClosingFence(line, fence, openFence)) {
        openFence = null;
      }
      out.push(line);
      continue;
    }
    if (fence !== null) {
      openFence = fence;
      out.push(line);
      continue;
    }
    const match = ATX_HEADING_RE.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const [, hashes, rest] = match;
    const newDepth = Math.min(6, hashes.length + levels);
    out.push(`${"#".repeat(newDepth)}${rest}`);
  }
  return out.join("\n");
}

function renderTextTurn(result: ToolResultComplete, timestamps: Map<string, number>): string {
  const role = roleOf(result);
  const epochMs = timestamps.get(result.uuid);
  // Use `!== undefined` rather than truthiness so a 0 (Unix epoch)
  // timestamp still renders. Practically irrelevant for live chat, but
  // it removes a foot-gun for any synthetic / migrated session that
  // ends up with that boundary value.
  const time = epochMs !== undefined ? ` · ${formatHHMM(epochMs)}` : "";
  // Speaker is `##`; demote any in-body heading by 2 so it always sits
  // strictly below the speaker (`#` → `###`, `##` → `####`, …).
  const body = demoteHeadings(textOf(result).trim(), 2);
  return body.length > 0 ? `## ${ROLE_LABELS[role]}${time}\n\n${body}` : `## ${ROLE_LABELS[role]}${time}`;
}

/** Resolve presentDocument's `data.markdown` to inline content. If the
 *  value is a workspace path, defer to `readFile`; otherwise treat it
 *  as inline markdown. Returns null when the data is missing/empty or
 *  the file read fails. */
async function presentDocumentBody(result: ToolResultComplete, readFile: ExportChatOptions["readFile"]): Promise<string | null> {
  const { data } = result;
  if (!isRecord(data)) return null;
  const { markdown } = data;
  if (typeof markdown !== "string" || markdown.length === 0) return null;
  if (!looksLikeDocumentPath(markdown)) return markdown;
  if (!readFile) return null;
  // Honour the documented "returns null on failure" contract — a
  // single rejected resolver shouldn't blow up the whole export.
  try {
    return await readFile(markdown);
  } catch {
    return null;
  }
}

async function renderToolTurn(result: ToolResultComplete, timestamps: Map<string, number>, readFile: ExportChatOptions["readFile"]): Promise<string> {
  const epochMs = timestamps.get(result.uuid);
  const time = epochMs !== undefined ? ` ${formatHHMM(epochMs)}` : "";
  const marker = `## ⬛︎ ${result.toolName}${time}`;

  if (result.toolName === PRESENT_DOCUMENT_TOOL) {
    const documentBody = await presentDocumentBody(result, readFile);
    if (documentBody !== null) {
      return `${marker}\n\n${demoteHeadings(documentBody.trim(), 2)}`;
    }
  }

  return marker;
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

/** Convert a chat session to a Markdown string. Async because
 *  presentDocument's body may live on disk and need a `readFile` round
 *  trip. Returns at minimum a non-empty header so callers never have
 *  to special-case empty sessions. */
export async function exportChatToMarkdown(results: readonly ToolResultComplete[], options: ExportChatOptions = {}): Promise<string> {
  const timestamps = options.resultTimestamps ?? new Map<string, number>();
  const turns = await Promise.all(
    results.map((result) =>
      isTextResponse(result) ? Promise.resolve(renderTextTurn(result, timestamps)) : renderToolTurn(result, timestamps, options.readFile),
    ),
  );
  const body = turns.join("\n\n---\n\n");
  const header = renderHeader(options);
  return body.length > 0 ? `${header}\n\n${body}\n` : `${header}\n`;
}
