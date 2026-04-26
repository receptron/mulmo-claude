// Per-profile tuning for the Claude Code backend. The shape here is
// intentionally Claude-CLI-shaped — `model`, `maxBudgetUsd`,
// `noSessionPersistence` are CLI flags, not portable concepts. Other
// backends (openai.tuning.ts, ollama.tuning.ts) own their own files
// with their own knob vocabulary; nothing is shared except the
// ProfileName union from types.ts.
//
// The `satisfies Record<ProfileName, ClaudeCodeProfile>` line at the
// bottom is load-bearing: adding a name to ProfileName is a compile
// error here until an entry exists, and every entry must match the
// Claude profile shape.

import { ONE_MINUTE_MS } from "../../utils/time.js";
import type { ProfileName } from "./types.js";

export interface ClaudeCodeProfile {
  /** Three Claude-CLI invocation shapes the auxiliary callers use:
   *
   *   "text-stdin" — prompt via stdin, `--output-format text`.
   *     Used when prompts can be very large (full day's chat
   *     transcripts) and shouldn't go through argv. No structured
   *     error envelope; non-zero exit surfaces as plain stderr.
   *
   *   "text-envelope" — prompt via argv `-p`, `--output-format json`
   *     without `--json-schema`. The model emits free-form text
   *     (e.g. markdown) which the adapter extracts from the
   *     envelope's `result` field. Used when callers want
   *     structured-error detection (budget exhaustion, auth) but
   *     the output itself is free-form.
   *
   *   "json-schema" — prompt via argv `-p`, `--output-format json`
   *     with `--json-schema`. The model's structured output is
   *     extracted from the envelope's `structured_output` field
   *     and returned to the caller as `T`. */
  outputFormat: "text-stdin" | "text-envelope" | "json-schema";
  /** --model. Omit to use the CLI's default. One-shot summarization
   *  workloads typically use haiku for cost; the agent loop uses
   *  the default. */
  model?: "haiku" | "sonnet" | "opus";
  /** --max-budget-usd. Omit for no cap. */
  maxBudgetUsd?: number;
  /** --no-session-persistence: don't record this turn in the user's
   *  ~/.claude session log. Appropriate for one-shot batch work. */
  noSessionPersistence?: boolean;
  /** Run from tmpdir() so the CLI doesn't load the project's
   *  CLAUDE.md / plugins / memory and inflate the prompt. */
  isolatedFromProject?: boolean;
  /** Wall-clock cap per invocation. */
  timeoutMs: number;
}

export const claudeCodeTuning = {
  "journal-archivist": {
    outputFormat: "text-stdin",
    timeoutMs: 5 * ONE_MINUTE_MS,
  },
  "source-summarize": {
    outputFormat: "text-envelope",
    model: "haiku",
    // A daily brief is longer + more expensive than a classify call,
    // so the cap is higher than the classifier's 0.05. 0.25 covers
    // several hundred items comfortably.
    maxBudgetUsd: 0.25,
    noSessionPersistence: true,
    isolatedFromProject: true,
    timeoutMs: 5 * ONE_MINUTE_MS,
  },
  "chat-index-summary": {
    outputFormat: "json-schema",
    model: "haiku",
    // Previously 0.05 was tight enough that a first-burst call —
    // which pays a one-time cache-creation cost on haiku (~28k
    // cache-creation tokens) — would trip the cap and fail with
    // `error_max_budget_usd` even for tiny 600-char transcripts.
    // 0.15 leaves headroom for cache creation + a generous output
    // allowance while still capping a 100-session backfill to well
    // under $20.
    maxBudgetUsd: 0.15,
    noSessionPersistence: true,
    isolatedFromProject: true,
    timeoutMs: 2 * ONE_MINUTE_MS,
  },
  "source-classify": {
    outputFormat: "json-schema",
    model: "haiku",
    // Cheap one-shot — small prompt, no cache-creation amortization
    // needed because the prompt doesn't trigger the haiku
    // first-burst cost the way chat-index does.
    maxBudgetUsd: 0.05,
    noSessionPersistence: true,
    isolatedFromProject: true,
    timeoutMs: 2 * ONE_MINUTE_MS,
  },
} as const satisfies Record<ProfileName, ClaudeCodeProfile>;
