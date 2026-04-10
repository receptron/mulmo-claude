import { spawn } from "child_process";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import type { SummaryResult } from "./types.js";

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

const MAX_INPUT_CHARS = 8000;
const HEAD_CHARS = 3000;
const TAIL_CHARS = 5000;
const PER_MESSAGE_MAX = 500;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUDGET_USD = 0.05;

interface JsonlEntry {
  source?: string;
  type?: string;
  message?: string;
}

function trimMessage(text: string): string {
  if (text.length <= PER_MESSAGE_MAX) return text;
  return text.slice(0, PER_MESSAGE_MAX) + "…";
}

// Walk a session jsonl and pull out only the user / assistant text
// turns, joined into a compact transcript. Tool results are skipped
// because they are noisy and rarely add to a useful summary.
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
    if (
      (source === "user" || source === "assistant") &&
      entry.type === "text" &&
      typeof entry.message === "string"
    ) {
      parts.push(`[${source}] ${trimMessage(entry.message)}`);
    }
  }
  return parts.join("\n\n");
}

// Long sessions get truncated to first ~3000 + last ~5000 chars so
// claude sees both the original topic and the most recent state.
export function truncate(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  return `${head}\n\n…\n\n${tail}`;
}

export async function summarizeJsonl(
  jsonlPath: string,
  opts: { timeoutMs?: number } = {},
): Promise<SummaryResult> {
  const content = await readFile(jsonlPath, "utf-8");
  const text = truncate(extractText(content));
  if (!text.trim()) {
    return { title: "(empty session)", summary: "", keywords: [] };
  }
  return runClaude(text, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

function runClaude(input: string, timeoutMs: number): Promise<SummaryResult> {
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
    // Run from tmpdir so claude does not load the project's CLAUDE.md
    // / plugins / memory and inflate the context.
    const proc = spawn("claude", args, {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`claude summarize timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `claude summarize exited with code ${code}: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }
      try {
        resolve(parseClaudeJsonResult(stdout));
      } catch (err) {
        reject(err);
      }
    });
  });
}

interface ClaudeJsonResult {
  type?: string;
  is_error?: boolean;
  structured_output?: unknown;
  result?: string;
}

export function parseClaudeJsonResult(stdout: string): SummaryResult {
  let parsed: ClaudeJsonResult;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(
      `failed to parse claude json output: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (parsed.is_error) {
    throw new Error(`claude returned error: ${parsed.result ?? "unknown"}`);
  }
  return validateSummaryResult(parsed.structured_output);
}

export function validateSummaryResult(obj: unknown): SummaryResult {
  if (typeof obj !== "object" || obj === null) {
    throw new Error("summary result is not an object");
  }
  const o = obj as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : "";
  const summary = typeof o.summary === "string" ? o.summary : "";
  const keywords = Array.isArray(o.keywords)
    ? o.keywords.filter((k): k is string => typeof k === "string")
    : [];
  return { title, summary, keywords };
}
