// Summarizes a single session jsonl into a title / summary /
// keywords triple via the active LLM backend. Cherry-picked and
// trimmed from the closed PR #94.
//
// Splits cleanly into two layers so tests can exercise the pure
// bits without invoking the backend:
//
//   extractText / truncate         — jsonl → prompt input
//   validateSummaryResult          — unknown → SummaryResult
//
// `defaultSummarize` composes them and calls
// `backend.generateStructured`. Tests inject their own SummarizeFn
// via `IndexerDeps.summarize`.

import { EVENT_TYPES } from "../../../src/types/events.js";
import { readFile } from "node:fs/promises";
import { getActiveBackend } from "../../agent/backend/index.js";
import { ClaudeCliNotFoundError } from "../journal/archivist-cli.js";
import { errorMessage } from "../../utils/errors.js";
import { formatSpawnFailure } from "../../utils/spawn.js";
import type { SummaryResult } from "./types.js";
import { isRecord } from "../../utils/types.js";

// Re-export so chat-index callers keep their existing import path
// (../chat-index/summarizer or ../journal/archivist-cli — both work).
export { ClaudeCliNotFoundError };

const SYSTEM_PROMPT =
  "You summarize a single chat session. Output strict JSON matching the provided schema. " +
  "Rules: title <= 60 characters in the source language, summary <= 200 characters in the same language, " +
  "5 to 10 short lowercase keywords useful for search. Respond with structured output only.";

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
  },
  required: ["title", "summary", "keywords"],
};

// Prompt-building constants.
const MAX_INPUT_CHARS = 8000;
const HEAD_CHARS = 3000;
const TAIL_CHARS = 5000;
const PER_MESSAGE_MAX = 500;

// Any module that wants to drive the summarizer — including the
// indexer — takes a SummarizeFn so tests can supply a deterministic
// fake. Production path is `defaultSummarize` below.
export type SummarizeFn = (input: string) => Promise<SummaryResult>;

interface JsonlEntry {
  source?: string;
  type?: string;
  message?: string;
}

function trimMessage(text: string): string {
  if (text.length <= PER_MESSAGE_MAX) return text;
  return `${text.slice(0, PER_MESSAGE_MAX)}…`;
}

// Walk a session jsonl and keep only the user / assistant text
// turns, joined into a compact transcript. Tool results are
// skipped because they are noisy and rarely contribute to a useful
// summary title.
export function extractText(jsonlContent: string): string {
  const lines = jsonlContent.split("\n").filter(Boolean);
  const parts: string[] = [];
  for (const line of lines) {
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const source = entry.source;
    if ((source === "user" || source === "assistant") && entry.type === EVENT_TYPES.text && typeof entry.message === "string") {
      parts.push(`[${source}] ${trimMessage(entry.message)}`);
    }
  }
  return parts.join("\n\n");
}

// Long sessions are truncated to first ~3000 + last ~5000 chars so
// the model sees both the original topic and the most recent state.
export function truncate(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  return `${head}\n\n…\n\n${tail}`;
}

// Runtime-validate an arbitrary value into a SummaryResult. Missing
// or wrong-typed fields fall back to safe defaults rather than
// crashing the indexer — a degraded title is better than a dropped
// session.
export function validateSummaryResult(obj: unknown): SummaryResult {
  if (!isRecord(obj)) {
    throw new Error("[chat-index] summary result is not an object");
  }
  const record = obj as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title : "";
  const summary = typeof record.summary === "string" ? record.summary : "";
  const keywords = Array.isArray(record.keywords) ? record.keywords.filter((keyword): keyword is string => typeof keyword === "string") : [];
  return { title, summary, keywords };
}

interface ClaudeJsonResult {
  type?: string;
  is_error?: boolean;
  structured_output?: unknown;
  result?: string;
}

// Pure: parse the JSON envelope `claude --output-format json`
// prints, raising a useful error if the envelope is malformed or
// the CLI reported an error. Retained as a test-callable helper
// that documents the envelope shape; the production path goes
// through `backend.generateStructured`, which extracts
// `structured_output` itself.
export function parseClaudeJsonResult(stdout: string): SummaryResult {
  let parsed: ClaudeJsonResult;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`[chat-index] failed to parse claude json output: ${errorMessage(err)}`);
  }
  if (parsed.is_error) {
    throw new Error(`[chat-index] claude returned error: ${parsed.result ?? "unknown"}`);
  }
  return validateSummaryResult(parsed.structured_output);
}

// Curried log prefix for `formatSpawnFailure`. Retained as a
// test-callable helper covering the structured-error-on-stdout
// path; production code uses `formatSpawnFailure` directly via
// the adapter.
export function formatSpawnError(code: number | null, stdout: string, stderr: string): string {
  return formatSpawnFailure("[chat-index]", code, stdout, stderr);
}

// Read a jsonl file and produce the pre-truncated transcript that
// goes into the prompt. Returns the empty string for an empty
// or unreadable file so the caller can decide whether to skip.
export async function loadJsonlInput(jsonlPath: string): Promise<string> {
  try {
    const content = await readFile(jsonlPath, "utf-8");
    return truncate(extractText(content));
  } catch {
    return "";
  }
}

// Production SummarizeFn: drive the active backend. Tests inject
// their own SummarizeFn that bypasses the backend entirely.
export const defaultSummarize: SummarizeFn = async (input: string) => {
  const result = await getActiveBackend().generateStructured<unknown>(
    {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: input,
      profile: "chat-index-summary",
    },
    SUMMARY_SCHEMA,
  );
  return validateSummaryResult(result);
};
