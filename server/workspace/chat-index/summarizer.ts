// Summarizes a single session jsonl into a title / summary /
// keywords triple using the Claude Code CLI. Cherry-picked and
// trimmed from the closed PR #94.
//
// Splits cleanly into three layers so tests can exercise the pure
// bits without spawning the CLI:
//
//   extractText / truncate         — jsonl → prompt input
//   parseClaudeJsonResult          — CLI stdout → SummaryResult
//   validateSummaryResult          — unknown → SummaryResult
//
// `defaultSummarize` composes them with the real spawn; tests
// inject their own SummarizeFn via `IndexerDeps.summarize`.

import { spawn } from "node:child_process";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { readFile } from "node:fs/promises";
import { formatSpawnFailure } from "../../utils/spawn.js";
import { tmpdir } from "node:os";
import { ClaudeCliNotFoundError } from "../journal/archivist-cli.js";
import { errorMessage } from "../../utils/errors.js";
import type { SummaryResult } from "./types.js";
import { ONE_MINUTE_MS } from "../../utils/time.js";
import { isRecord } from "../../utils/types.js";
import { claudeBinPath } from "../../utils/claudeBin.js";

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

// Default model used when a caller doesn't specify one. Sonnet, not
// haiku: the title is the primary way a user finds a past chat, so a
// weak title makes the history list unusable. Since #1944 the model
// is user-selectable from Settings → Chat index — "off" disables the
// indexer, "haiku" / "sonnet" pick the model here — so this constant
// is only the internal fallback when the indexer runs without a
// model override (e.g. a manual rebuild triggered before the setting
// resolves).
const DEFAULT_SUMMARY_MODEL = "sonnet";
// Explicit union so a bad string from the settings layer can't reach
// the CLI unchecked. Mirror in `AppSettings.chatIndex` (server/system/config.ts).
export type SummaryModel = "haiku" | "sonnet";

// Prompt-building constants. Sized for Sonnet's large context: the
// window is wide enough to carry a long, topic-shifting session's
// middle (not just head + tail), and per-message clipping keeps the
// substance of long turns. Exported so the summarizer tests derive
// their fixtures from them rather than hard-coding sizes that rot.
export const MAX_INPUT_CHARS = 30000;
export const HEAD_CHARS = 12000;
export const TAIL_CHARS = 16000;
export const PER_MESSAGE_MAX = 1500;

// Spawn / budget constants.
const DEFAULT_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
// Budget cap per summarization call, forwarded to `claude
// --max-budget-usd`. A first-burst call pays a one-time cache-creation
// cost (~28k tokens) that on Sonnet's pricing would trip a tighter cap
// and fail with `error_max_budget_usd` — yielding NO title at all.
// 0.40 leaves headroom for cache creation plus the wider input window
// while still bounding a full backfill.
const MAX_BUDGET_USD = 0.4;

// Any module that wants to drive the summarizer — including the
// indexer — takes a SummarizeFn so tests can supply a deterministic
// fake. Production path is `defaultSummarize` below.
export type SummarizeFn = (input: string, opts?: { model?: SummaryModel }) => Promise<SummaryResult>;

interface JsonlEntry {
  source?: string;
  type?: string;
  message?: string;
}

/** A jsonl line we can read. Only the fields the caller touches are required to
 *  be the right type; anything else on the line is ignored. */
function isJsonlEntry(value: unknown): value is JsonlEntry {
  if (!isRecord(value)) return false;
  return (
    (value.source === undefined || typeof value.source === "string") &&
    (value.type === undefined || typeof value.type === "string") &&
    (value.message === undefined || typeof value.message === "string")
  );
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
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // The `JsonlEntry` annotation used to sit on the parse result, which is
    // `any` — it described the line without verifying it. The guard does the
    // describing now.
    if (!isJsonlEntry(entry)) continue;
    const { source } = entry;
    if ((source === "user" || source === "assistant") && entry.type === EVENT_TYPES.text && typeof entry.message === "string") {
      parts.push(`[${source}] ${trimMessage(entry.message)}`);
    }
  }
  return parts.join("\n\n");
}

// Long sessions are clipped to first ~12000 + last ~16000 chars so
// claude sees both the original topic and the most recent state.
// Distinct from the simple-tail `truncate()` in `server/utils/text.ts`
// — the summarizer needs context from both ends, not just the head.
export function truncateMiddle(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  return `${head}\n\n…\n\n${tail}`;
}

interface ClaudeJsonResult {
  type?: string;
  is_error?: boolean;
  structured_output?: unknown;
  result?: string;
}

// Parse the JSON envelope that `claude --output-format json`
// prints, raising a useful error if the envelope is malformed or
// the CLI reported an error.
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

// Build the error message for a non-zero `claude` CLI exit.
//
// The claude CLI writes its structured result — including error
// envelopes like `{"is_error":true,"subtype":"error_max_budget_usd",
// "errors":["Reached maximum budget ($0.05)"]}` — to **stdout**,
// not stderr. Our previous handler only inspected stderr, so
// budget-exhaustion and similar failures surfaced as
// `claude summarize exited 1:` with no details at all, making
// them impossible to diagnose from the log.
//
// Strategy: try to parse stdout as a claude JSON envelope first
// and extract a human-readable reason from `errors[]` /
// `subtype` / `result`; fall back to stderr, then to a raw
// stdout slice, then to a generic "no error output".
export function formatSpawnError(code: number | null, stdout: string, stderr: string): string {
  return formatSpawnFailure("[chat-index]", code, stdout, stderr);
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

// Read a jsonl file and produce the pre-truncated transcript that
// goes into the CLI prompt. Returns the empty string for an empty
// or unreadable file so the caller can decide whether to skip.
export async function loadJsonlInput(jsonlPath: string): Promise<string> {
  try {
    const content = await readFile(jsonlPath, "utf-8");
    return truncateMiddle(extractText(content));
  } catch {
    return "";
  }
}

// --- spawn layer ----------------------------------------------------

// The `claude` CLI argv for one summarization. Pure — extracted so the spawn
// executor stays small and the flag list is unit-testable on its own.
export function buildSummarizeCliArgs(input: string, model: SummaryModel): string[] {
  return [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--model",
    model,
    "--max-budget-usd",
    String(MAX_BUDGET_USD),
    "--json-schema",
    JSON.stringify(SUMMARY_SCHEMA),
    "--system-prompt",
    SYSTEM_PROMPT,
    "-p",
    input,
  ];
}

function spawnClaudeSummarize(input: string, timeoutMs: number, model: SummaryModel): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = buildSummarizeCliArgs(input, model);
    // Run from tmpdir so claude does not load the project's
    // CLAUDE.md / plugins / memory and inflate the context.
    const proc = spawn(claudeBinPath(), args, {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error(`[chat-index] claude summarize timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new ClaudeCliNotFoundError());
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(formatSpawnError(code, stdout, stderr)));
        return;
      }
      resolve(stdout);
    });
  });
}

// Production SummarizeFn: prepare the input from a jsonl path and
// drive the CLI. Tests inject their own SummarizeFn that bypasses
// the CLI entirely.
export const defaultSummarize: SummarizeFn = async (input, opts) => {
  const model: SummaryModel = opts?.model ?? DEFAULT_SUMMARY_MODEL;
  const stdout = await spawnClaudeSummarize(input, DEFAULT_TIMEOUT_MS, model);
  return parseClaudeJsonResult(stdout);
};
