// Pure classification for built-in Claude tool_result events.
// Decides whether a given tool result should be stored in the session
// jsonl as a pointer to a real workspace file, inlined verbatim, or
// inlined with truncation. No filesystem access — callers do I/O
// separately and feed the result here.
//
// See plans/done/feat-tool-trace-persistence.md for the design rationale.

export type Classification =
  | { kind: "pointer"; contentRef: string }
  | { kind: "inline"; content: string; truncated: boolean };

// Max characters kept when content is stored inline in the jsonl.
// Picked to keep per-turn jsonl size sane while still capturing
// enough of a small Bash/Grep output to be useful for debugging.
export const MAX_INLINE_CONTENT_CHARS = 4096;

// Tools whose `args.file_path` already points at an existing file —
// the jsonl can simply reference that path instead of duplicating the
// content. Matches Claude Code's built-in file tool names exactly.
const FILE_POINTER_TOOLS = new Set(["Read", "Write", "Edit"]);

// Image-generation MCP tools. The tool result already carries the
// saved path so we extract it; the raw bytes/base64 never leave the
// agent stream memory.
const IMAGE_TOOLS = new Set(["generateImage", "editImage"]);

// Tool name we always route through `writeSearch.ts` before
// classifying. Exposed so callers know which tools need a
// pre-computed `searchContentRef` injected.
export const WEB_SEARCH_TOOL_NAME = "WebSearch";

export interface ClassifyInput {
  toolName: string;
  args: unknown;
  content: string;
  // Optional pre-computed contentRef for WebSearch — the caller saves
  // the result file first (in `writeSearch.ts`) and passes the
  // workspace-relative path in here.
  searchContentRef?: string;
}

export function classifyToolResult(input: ClassifyInput): Classification {
  const { toolName, args, content, searchContentRef } = input;

  if (toolName === WEB_SEARCH_TOOL_NAME && searchContentRef) {
    return { kind: "pointer", contentRef: searchContentRef };
  }

  if (FILE_POINTER_TOOLS.has(toolName)) {
    const ref = filePointerFromArgs(args);
    if (ref) return { kind: "pointer", contentRef: ref };
  }

  if (IMAGE_TOOLS.has(toolName)) {
    const ref = imagePointerFromContent(content);
    if (ref) return { kind: "pointer", contentRef: ref };
  }

  return inlineWithTruncation(content);
}

function filePointerFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const raw = record.file_path;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return normalizeWorkspacePath(raw);
}

// Image MCP tool results typically include a saved path somewhere in
// the stringified result. Be conservative: only treat it as a pointer
// when we can confidently extract an `images/` or absolute path. No
// match → fall back to inline (truncated) handling so the record
// still carries *something* useful.
function imagePointerFromContent(content: string): string | null {
  // Matches a JSON-ish "filePath": "..." or "path": "..." value
  // without using regex backtracking. Look for known keys then scan
  // the quoted value.
  for (const key of ['"filePath":', '"path":', '"file":']) {
    const idx = content.indexOf(key);
    if (idx === -1) continue;
    const afterKey = content.slice(idx + key.length);
    const quoteStart = afterKey.indexOf('"');
    if (quoteStart === -1) continue;
    const quoteEnd = afterKey.indexOf('"', quoteStart + 1);
    if (quoteEnd === -1) continue;
    const raw = afterKey.slice(quoteStart + 1, quoteEnd);
    if (raw.length === 0) continue;
    return normalizeWorkspacePath(raw);
  }
  return null;
}

// Strip a leading "/" or "./" so the stored ref is workspace-relative
// regardless of how the tool happened to quote it. Leave "../"
// prefixes alone — a relative escape is a bug and we want it visible
// rather than silently fixed up.
function normalizeWorkspacePath(p: string): string {
  if (p.startsWith("./")) return p.slice(2);
  if (p.startsWith("/")) return p.slice(1);
  return p;
}

function inlineWithTruncation(content: string): Classification {
  if (content.length <= MAX_INLINE_CONTENT_CHARS) {
    return { kind: "inline", content, truncated: false };
  }
  return {
    kind: "inline",
    content: content.slice(0, MAX_INLINE_CONTENT_CHARS),
    truncated: true,
  };
}
