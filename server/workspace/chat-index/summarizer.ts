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
import { ClaudeCliNotFoundError } from "../journal/archivist.js";
import { errorMessage } from "../../utils/errors.js";
import type { SummaryResult } from "./types.js";
import { isRecord } from "../../utils/types.js";

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

// Spawn / budget constants.
const DEFAULT_TIMEOUT_MS = 120_000;
// Budget cap per summarization call, forwarded to `claude
// --max-budget-usd`. Previously 0.05 but that was tight enough
// that a first-burst call — which pays a one-time cache creation
// cost on haiku (~28k cache-creation tokens) — would trip the cap
// and fail with `error_max_budget_usd` even for tiny 600-char
// transcripts. 0.15 leaves comfortable headroom for cache
// creation + a generous output allowance while still capping a
// full 100-session backfill to well under $20.
const MAX_BUDGET_USD = 0.15;

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
// claude sees both the original topic and the most recent state.
export function truncate(text: string): string {
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
    return truncate(extractText(content));
  } catch {
    return "";
  }
}

// --- spawn layer ----------------------------------------------------

function spawnClaudeSummarize(input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "--print",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--model",
      "haiku",
      "--max-budget-usd",
      String(MAX_BUDGET_USD),
      "--json-schema",
      JSON.stringify(SUMMARY_SCHEMA),
      "--system-prompt",
      SYSTEM_PROMPT,
      "-p",
      input,
    ];
    // Run from tmpdir so claude does not load the project's
    // CLAUDE.md / plugins / memory and inflate the context.
    const proc = spawn("claude", args, {
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
export const defaultSummarize: SummarizeFn = async (input: string) => {
  const stdout = await spawnClaudeSummarize(input, DEFAULT_TIMEOUT_MS);
  return parseClaudeJsonResult(stdout);
};
