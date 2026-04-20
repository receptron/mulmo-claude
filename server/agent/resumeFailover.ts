// Fail-over for `claude --resume <sessionId>` errors (#211).
//
// When a stored `claudeSessionId` no longer exists in the Claude CLI's
// local store (cache evicted, CLI reinstalled, machine migration),
// the CLI exits non-zero with:
//
//   No conversation found with session ID: <uuid>
//
// Our jsonl transcript still has the full human-visible turns, so
// this module provides the two primitives the agent loop needs to
// recover:
//
//  - `isStaleSessionError(message)`: narrow pattern match on the
//    stderr line the CLI emits. Stable across the CLI versions we've
//    observed; anchored on the full phrase to avoid false positives.
//  - `buildTranscriptPreamble(jsonl, opts)`: reads the same jsonl
//    format `server/routes/agent.ts` appends to, filters to
//    human-visible text turns (skipping tool_call / tool_result /
//    tool_call_result — those don't replay cleanly as natural
//    language), and renders the most recent N bytes as an inline
//    preamble that can be prepended to the user's new message.
//
// Orchestration (detect → clear stale id → re-run without `--resume`
// with preamble) lives in `server/routes/agent.ts` where the
// surrounding meta-file and pub-sub plumbing already sits.

import { EVENT_TYPES } from "../../src/types/events.js";
import { isRecord } from "../utils/types.js";

const STALE_SESSION_PHRASE = "No conversation found with session ID";

export function isStaleSessionError(message: string): boolean {
  return message.includes(STALE_SESSION_PHRASE);
}

// Budget for the transcript replay. 50KB is the cap the issue calls
// out — big enough for ~30 medium turns, small enough that Claude's
// context isn't dominated by the replay. Callers may override, but
// defaulting here keeps every call site consistent.
export const DEFAULT_TRANSCRIPT_MAX_CHARS = 50_000;

interface TranscriptEntry {
  source: "user" | "assistant";
  text: string;
}

export interface BuildPreambleOptions {
  /** Hard cap on the preamble body (excluding the framing header /
   *  footer). Older turns are dropped to fit. */
  maxChars?: number;
}

/**
 * Build a natural-language preamble from a session jsonl string.
 * Returns "" when no replayable turns exist (no transcript, or every
 * entry was a tool call / non-text event).
 */
export function buildTranscriptPreamble(
  jsonlContent: string,
  opts: BuildPreambleOptions = {},
): string {
  const entries = parseTranscriptEntries(jsonlContent);
  if (entries.length === 0) return "";

  const maxChars = opts.maxChars ?? DEFAULT_TRANSCRIPT_MAX_CHARS;
  const { kept, truncated } = selectMostRecent(entries, maxChars);
  if (kept.length === 0) return "";

  return formatPreamble(kept, truncated);
}

function parseTranscriptEntries(jsonlContent: string): TranscriptEntry[] {
  const out: TranscriptEntry[] = [];
  for (const line of jsonlContent.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    const o = entry;
    if (o.type !== EVENT_TYPES.text) continue;
    if (o.source !== "user" && o.source !== "assistant") continue;
    const message = o.message;
    if (typeof message !== "string" || message.length === 0) continue;
    out.push({ source: o.source, text: message });
  }
  return out;
}

// Walk entries newest-first, include each one whose addition keeps
// the running total ≤ maxChars. Reverse the kept slice so the
// preamble is chronological. The `truncated` flag lets the caller
// tell Claude "earlier turns were dropped" instead of silently
// showing a partial history.
function selectMostRecent(
  entries: TranscriptEntry[],
  maxChars: number,
): { kept: TranscriptEntry[]; truncated: boolean } {
  const picked: TranscriptEntry[] = [];
  let size = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const entrySize = entry.source.length + entry.text.length + 3; // ": " + "\n"
    if (size + entrySize > maxChars) {
      return { kept: picked.reverse(), truncated: true };
    }
    picked.push(entry);
    size += entrySize;
  }
  return { kept: picked.reverse(), truncated: false };
}

function formatPreamble(
  entries: TranscriptEntry[],
  truncated: boolean,
): string {
  const lines: string[] = [];
  lines.push(
    "[Continuing from an earlier session. The original Claude CLI " +
      "session id is no longer available, so the transcript below " +
      "is replayed from the local jsonl so you have context.]",
  );
  lines.push("");
  if (truncated) {
    lines.push("[...earlier turns omitted for length...]");
  }
  for (const entry of entries) {
    const label = entry.source === "user" ? "User" : "Assistant";
    lines.push(`${label}: ${entry.text}`);
  }
  lines.push("");
  lines.push("[End of prior transcript. The user's new message follows.]");
  lines.push("");
  return lines.join("\n");
}
