// Daily-summary generator.
//
// Takes the cross-source-deduped list of new items and asks
// `claude` (haiku, budget-capped) to produce the human-readable
// daily brief markdown. The pipeline then pairs that markdown
// with a machine-readable JSON block (see write.ts) so the
// dashboard can consume item metadata without parsing markdown.
//
// Shape mirrors `chat-index/summarizer.ts` — same CLI flags, same
// "errors on STDOUT not stderr" handling, same injectable
// `SummarizeFn` so tests never invoke the real CLI.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { ClaudeCliNotFoundError } from "../../journal/archivist-cli.js";
import { formatSpawnFailure } from "../../../utils/spawn.js";
import { errorMessage } from "../../../utils/errors.js";
import type { SourceItem } from "../types.js";
import { CLI_SUBPROCESS_TIMEOUT_MS } from "../../../utils/time.js";

// A function that takes items and returns markdown. The
// production implementation spawns claude; tests pass a
// deterministic stub.
export type SummarizeFn = (items: readonly SourceItem[]) => Promise<string>;

// Wall-clock cap per summarize call. 5 minutes is plenty for a
// daily brief across a few dozen items; beyond that the call is
// almost certainly wedged.
export const DEFAULT_TIMEOUT_MS = CLI_SUBPROCESS_TIMEOUT_MS;

// Budget per summarize call. A daily brief is longer and more
// expensive than a classify call, so the cap is higher than the
// classifier's $0.05. $0.25 covers several hundred items
// comfortably.
const MAX_BUDGET_USD = 0.25;

const SYSTEM_PROMPT =
  "You write a daily information brief from a JSON list of items. " +
  "Group items by the `categories` field (one heading per category you see), " +
  "sorted by the most items per category first; within each category, list newest-first by `publishedAt`. " +
  "Use Markdown headings: `# Daily brief — YYYY-MM-DD` as the top heading, then `## <Category>` per group. " +
  "Each item is one bullet: `- [title](url) — one-line summary`. " +
  "Keep summaries under 140 characters. Prefer the item's own summary when present; otherwise paraphrase the title. " +
  "Do NOT emit a JSON block, table of contents, or anything outside the brief itself — the caller appends machine-readable data separately. " +
  "Output Markdown only — no code fences, no prose commentary.";

// Shape passed to claude. Kept deliberately compact so the
// prompt stays within budget even for a busy day: no `content`
// field (full body), just `summary` truncated to 200 chars.
interface PromptItem {
  title: string;
  url: string;
  publishedAt: string;
  categories: string[];
  sourceSlug: string;
  summary?: string;
  severity?: string;
}

// Build the user-prompt JSON body. Exported so tests can verify
// the exact shape the CLI sees, and so a future "generate a
// test brief without summarizing" workflow can use the same
// input format.
export function buildSummarizePromptBody(items: readonly SourceItem[], isoDate: string): string {
  const compactItems: PromptItem[] = items.map((item) => {
    const base: PromptItem = {
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      categories: [...item.categories],
      sourceSlug: item.sourceSlug,
    };
    if (item.summary) base.summary = item.summary.slice(0, 200);
    if (item.severity) base.severity = item.severity;
    return base;
  });
  return [`DATE: ${isoDate}`, "", "ITEMS (JSON):", JSON.stringify(compactItems, null, 2)].join("\n");
}

// Fallback markdown when there are zero new items today.
// Writing a file even on an empty day makes it clear the pipeline
// ran; dashboards can still read it and show "no new items".
export function buildEmptyDayMarkdown(isoDate: string): string {
  return `# Daily brief — ${isoDate}\n\n_No new items today._\n`;
}

// Pure: parse the CLI envelope, surface structured errors,
// return the markdown body.
export function parseSummarizeOutput(stdout: string): string {
  let parsed: {
    is_error?: boolean;
    result?: string;
    errors?: unknown;
  };
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`[sources/summarize] failed to parse claude json: ${errorMessage(err)}`);
  }
  if (parsed.is_error) {
    const msg = Array.isArray(parsed.errors) && parsed.errors.length > 0 ? parsed.errors.join("; ") : (parsed.result ?? "unknown");
    throw new Error(`[sources/summarize] claude error: ${msg}`);
  }
  const result = typeof parsed.result === "string" ? parsed.result : "";
  if (!result) {
    throw new Error("[sources/summarize] claude returned empty / missing result");
  }
  return result;
}

// --- spawn layer --------------------------------------------------------

function spawnClaudeSummarize(userPrompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // `--output-format json` returns a result envelope containing
    // the model's text response as `.result` — we don't use
    // `--json-schema` here because the model produces free-form
    // markdown. Same "errors on stdout" handling as the
    // classifier / chat-index summarizer.
    const args = [
      "--print",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--model",
      "haiku",
      "--max-budget-usd",
      String(MAX_BUDGET_USD),
      "--system-prompt",
      SYSTEM_PROMPT,
      "-p",
      userPrompt,
    ];
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
      reject(new Error(`[sources/summarize] claude timed out after ${timeoutMs}ms`));
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
        reject(new Error(formatSpawnFailure("[sources/summarize]", code, stdout, stderr)));
        return;
      }
      resolve(stdout);
    });
  });
}

// Build the production SummarizeFn. `isoDate` is captured once
// per pipeline run so every call in that run uses the same date
// header (even if the run crosses midnight).
export function makeDefaultSummarize(isoDate: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): SummarizeFn {
  return async (items) => {
    if (items.length === 0) return buildEmptyDayMarkdown(isoDate);
    const prompt = buildSummarizePromptBody(items, isoDate);
    const stdout = await spawnClaudeSummarize(prompt, timeoutMs);
    return parseSummarizeOutput(stdout);
  };
}
