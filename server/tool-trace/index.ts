// Driver for persisting built-in Claude tool events to the session
// jsonl (#194). Called from routes/agent.ts for each tool_call and
// tool_call_result event. Fire-and-forget semantics: all failures are
// caught and log.warn'd with the `tool-trace` prefix.

import { appendFile } from "node:fs/promises";
import { log } from "../logger/index.js";
import { WEB_SEARCH_TOOL_NAME, classifyToolResult } from "./classify.js";
import { writeSearchResult } from "./writeSearch.js";

export interface ToolCallEvent {
  type: "tool_call";
  toolUseId: string;
  toolName: string;
  args: unknown;
}

export interface ToolCallResultEvent {
  type: "tool_call_result";
  toolUseId: string;
  content: string;
}

export type ToolTraceEvent = ToolCallEvent | ToolCallResultEvent;

export interface CachedCall {
  toolName: string;
  args: unknown;
}

export type ArgsCache = Map<string, CachedCall>;

export interface RecordToolEventDeps {
  workspaceRoot: string;
  chatSessionId: string;
  resultsFilePath: string;
  argsCache: ArgsCache;
  now?: () => Date;
  // Test hooks.
  appendLine?: (filePath: string, line: string) => Promise<void>;
  saveSearch?: typeof writeSearchResult;
}

export function createArgsCache(): ArgsCache {
  return new Map<string, CachedCall>();
}

const defaultAppendLine = (filePath: string, line: string) =>
  appendFile(filePath, line, "utf-8");

export async function recordToolEvent(
  event: ToolTraceEvent,
  deps: RecordToolEventDeps,
): Promise<void> {
  try {
    if (event.type === "tool_call") {
      await handleToolCall(event, deps);
      return;
    }
    await handleToolCallResult(event, deps);
  } catch (err) {
    log.warn("tool-trace", "recordToolEvent failed", {
      type: event.type,
      toolUseId: event.toolUseId,
      error: String(err),
    });
  }
}

async function handleToolCall(
  event: ToolCallEvent,
  deps: RecordToolEventDeps,
): Promise<void> {
  deps.argsCache.set(event.toolUseId, {
    toolName: event.toolName,
    args: event.args,
  });
  const now = (deps.now ?? (() => new Date()))();
  const record = {
    source: "tool",
    type: "tool_call",
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    args: event.args,
    ts: now.toISOString(),
  };
  await appendRecord(deps, record);
  logToolCall(event);
}

// Emit an info-level log when a tool fires. WebSearch and WebFetch
// get a little extra context (the query / URL) because those are the
// two tools whose progress users most often want to watch in real
// time.
function logToolCall(event: ToolCallEvent): void {
  if (event.toolName === "WebSearch") {
    const query = extractQuery(event.args);
    log.info("tool-trace", "web_search starting", {
      toolUseId: event.toolUseId,
      query: query ?? "<missing>",
    });
    return;
  }
  if (event.toolName === "WebFetch") {
    const url = extractUrl(event.args);
    log.info("tool-trace", "web_fetch starting", {
      toolUseId: event.toolUseId,
      url: url ?? "<missing>",
    });
    return;
  }
  log.debug("tool-trace", "tool_call", {
    toolUseId: event.toolUseId,
    toolName: event.toolName,
  });
}

function extractUrl(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const raw = record.url;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

// Emit progress on the result side. For WebSearch we specifically
// log the saved `contentRef` so operators can follow the breadcrumb
// from the server log straight to the on-disk search file.
function logToolCallResult(
  toolName: string,
  event: ToolCallResultEvent,
  classification:
    | { kind: "pointer"; contentRef: string }
    | { kind: "inline"; content: string; truncated: boolean },
  searchContentRef: string | undefined,
): void {
  if (toolName === "WebSearch" && searchContentRef) {
    log.info("tool-trace", "web_search saved", {
      toolUseId: event.toolUseId,
      contentRef: searchContentRef,
      bodyLen: event.content.length,
    });
    return;
  }
  if (toolName === "WebSearch") {
    // Save failed earlier → we already emitted a warn; record
    // inline-fallback landing at info so the pair stays matched.
    log.info("tool-trace", "web_search inlined (save failed)", {
      toolUseId: event.toolUseId,
      bodyLen: event.content.length,
    });
    return;
  }
  if (classification.kind === "pointer") {
    log.debug("tool-trace", "tool_call_result pointer", {
      toolUseId: event.toolUseId,
      toolName,
      contentRef: classification.contentRef,
    });
    return;
  }
  log.debug("tool-trace", "tool_call_result inline", {
    toolUseId: event.toolUseId,
    toolName,
    bodyLen: event.content.length,
    truncated: classification.truncated,
  });
}

async function handleToolCallResult(
  event: ToolCallResultEvent,
  deps: RecordToolEventDeps,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const cached = deps.argsCache.get(event.toolUseId);
  const toolName = cached?.toolName ?? "";
  const args = cached?.args ?? {};

  const searchContentRef = await maybeWriteSearch({
    toolName,
    args,
    content: event.content,
    chatSessionId: deps.chatSessionId,
    workspaceRoot: deps.workspaceRoot,
    now,
    saveSearch: deps.saveSearch,
  });

  const classification = classifyToolResult({
    toolName,
    args,
    content: event.content,
    searchContentRef,
  });

  const base = {
    source: "tool",
    type: "tool_call_result",
    toolUseId: event.toolUseId,
    toolName,
    ts: now.toISOString(),
  };
  const record =
    classification.kind === "pointer"
      ? { ...base, contentRef: classification.contentRef }
      : {
          ...base,
          content: classification.content,
          truncated: classification.truncated,
        };
  await appendRecord(deps, record);
  logToolCallResult(toolName, event, classification, searchContentRef);

  // Release the cache entry once consumed so long-lived sessions
  // don't accumulate stale tool_use ids.
  deps.argsCache.delete(event.toolUseId);
}

interface MaybeWriteSearchInputs {
  toolName: string;
  args: unknown;
  content: string;
  chatSessionId: string;
  workspaceRoot: string;
  now: Date;
  saveSearch?: typeof writeSearchResult;
}

async function maybeWriteSearch(
  inputs: MaybeWriteSearchInputs,
): Promise<string | undefined> {
  if (inputs.toolName !== WEB_SEARCH_TOOL_NAME) return undefined;
  const query = extractQuery(inputs.args);
  if (!query) return undefined;
  const save = inputs.saveSearch ?? writeSearchResult;
  try {
    return await save({
      workspaceRoot: inputs.workspaceRoot,
      query,
      sessionId: inputs.chatSessionId,
      ts: inputs.now,
      resultBody: inputs.content,
    });
  } catch (err) {
    log.warn("tool-trace", "writeSearchResult failed", {
      error: String(err),
    });
    return undefined;
  }
}

function extractQuery(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const record = args as Record<string, unknown>;
  const raw = record.query;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return raw;
}

async function appendRecord(
  deps: RecordToolEventDeps,
  record: object,
): Promise<void> {
  const append = deps.appendLine ?? defaultAppendLine;
  await append(deps.resultsFilePath, JSON.stringify(record) + "\n");
}
