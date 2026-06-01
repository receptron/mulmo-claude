// Production `translateBatch`: spawns the `claude` CLI in print
// mode with a JSON schema so the response array length is
// guaranteed to match the request. Same auth model as the rest of
// the server (no API key required).
//
// Patterned after `server/workspace/chat-index/summarizer.ts`.

import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { CLI_SUBPROCESS_TIMEOUT_MS } from "../../utils/time.js";
import { errorMessage } from "../../utils/errors.js";
import { formatSpawnFailure } from "../../utils/spawn.js";
import { isRecord } from "../../utils/types.js";
import { ClaudeCliNotFoundError } from "../../workspace/journal/archivist-cli.js";
import { claudeBinPath } from "../../utils/claudeBin.js";
import type { TranslateBatchFn } from "./types.js";

const SYSTEM_PROMPT =
  "You are a translation engine. The user input is a JSON object with `targetLanguage` (BCP-47) " +
  "and `sentences` (an array of English source strings). Translate each sentence into the target " +
  "language and return strict JSON matching the provided schema. The output `translations` array " +
  "MUST have the same length and order as the input `sentences` array. Preserve placeholders " +
  "such as `{name}`, `{count}`, `%s`, and HTML tags verbatim.";

const SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["translations"],
};

// Small per-call cap. A few dozen short UI strings on haiku costs
// fractions of a cent; this guards against runaway prompts only.
const MAX_BUDGET_USD = 0.5;

interface ClaudeJsonEnvelope {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
}

export function parseTranslations(stdout: string): string[] {
  let parsed: ClaudeJsonEnvelope;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`[translation] failed to parse claude json output: ${errorMessage(err)}`);
  }
  if (parsed.is_error) {
    throw new Error(`[translation] claude returned error: ${parsed.result ?? "unknown"}`);
  }
  if (!isRecord(parsed.structured_output)) {
    throw new Error("[translation] structured_output missing or not an object");
  }
  const { translations } = parsed.structured_output as Record<string, unknown>;
  if (!Array.isArray(translations) || !translations.every((value): value is string => typeof value === "string")) {
    throw new Error("[translation] translations is not a string array");
  }
  return translations;
}

function buildArgs(promptInput: string): string[] {
  return [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--model",
    "haiku",
    "--max-budget-usd",
    String(MAX_BUDGET_USD),
    "--json-schema",
    JSON.stringify(SCHEMA),
    "--system-prompt",
    SYSTEM_PROMPT,
    "-p",
    promptInput,
  ];
}

interface SpawnState {
  stdout: string;
  stderr: string;
  settled: boolean;
}

type RejectFn = (err: Error) => void;
type ResolveFn = (value: string) => void;

function onTimeout(state: SpawnState, proc: ChildProcess, reject: RejectFn, timeoutMs: number): void {
  if (state.settled) return;
  state.settled = true;
  proc.kill("SIGKILL");
  reject(new Error(`[translation] claude translate timed out after ${timeoutMs}ms`));
}

function onError(state: SpawnState, timer: ReturnType<typeof setTimeout>, err: Error & { code?: string }, reject: RejectFn): void {
  if (state.settled) return;
  state.settled = true;
  clearTimeout(timer);
  reject(err.code === "ENOENT" ? new ClaudeCliNotFoundError() : err);
}

function onClose(state: SpawnState, timer: ReturnType<typeof setTimeout>, code: number | null, resolve: ResolveFn, reject: RejectFn): void {
  if (state.settled) return;
  state.settled = true;
  clearTimeout(timer);
  if (code !== 0) {
    reject(new Error(formatSpawnFailure("[translation]", code, state.stdout, state.stderr)));
    return;
  }
  resolve(state.stdout);
}

function spawnClaudeTranslate(promptInput: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Run from tmpdir so claude does not load the project's
    // CLAUDE.md / plugins / memory and inflate the context.
    const proc = spawn(claudeBinPath(), buildArgs(promptInput), { cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
    const state: SpawnState = { stdout: "", stderr: "", settled: false };
    const timer = setTimeout(() => onTimeout(state, proc, reject, timeoutMs), timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => {
      state.stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      state.stderr += chunk.toString();
    });
    proc.on("error", (err: Error & { code?: string }) => onError(state, timer, err, reject));
    proc.on("close", (code) => onClose(state, timer, code, resolve, reject));
  });
}

export const defaultTranslateBatch: TranslateBatchFn = async ({ targetLanguage, sentences }) => {
  const promptInput = JSON.stringify({ targetLanguage, sentences });
  const stdout = await spawnClaudeTranslate(promptInput, CLI_SUBPROCESS_TIMEOUT_MS);
  return parseTranslations(stdout);
};
