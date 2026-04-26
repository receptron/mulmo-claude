// Daily-summary generator.
//
// Takes the cross-source-deduped list of new items and asks the
// active LLM backend (haiku, budget-capped) to produce the
// human-readable daily brief markdown. The pipeline then pairs
// that markdown with a machine-readable JSON block (see write.ts)
// so the dashboard can consume item metadata without parsing
// markdown.
//
// `makeDefaultSummarize` composes prompt + backend call. Tests
// inject their own SummarizeFn via the indexer's deps.

import { getActiveBackend } from "../../../agent/backend/index.js";
import { ClaudeCliNotFoundError } from "../../journal/archivist-cli.js";
import { errorMessage } from "../../../utils/errors.js";
import type { SourceItem } from "../types.js";
import { CLI_SUBPROCESS_TIMEOUT_MS } from "../../../utils/time.js";

// Re-export so existing callers / tests don't have to update imports.
export { ClaudeCliNotFoundError };

// A function that takes items and returns markdown. The
// production implementation drives the active backend; tests pass
// a deterministic stub.
export type SummarizeFn = (items: readonly SourceItem[]) => Promise<string>;

// Wall-clock cap kept exported for back-compat with callers that
// read it; the actual timeout per call now lives in the backend's
// tuning module under the "source-summarize" profile.
export const DEFAULT_TIMEOUT_MS = CLI_SUBPROCESS_TIMEOUT_MS;

const SYSTEM_PROMPT =
  "You write a daily information brief from a JSON list of items. " +
  "Group items by the `categories` field (one heading per category you see), " +
  "sorted by the most items per category first; within each category, list newest-first by `publishedAt`. " +
  "Use Markdown headings: `# Daily brief — YYYY-MM-DD` as the top heading, then `## <Category>` per group. " +
  "Each item is one bullet: `- [title](url) — one-line summary`. " +
  "Keep summaries under 140 characters. Prefer the item's own summary when present; otherwise paraphrase the title. " +
  "Do NOT emit a JSON block, table of contents, or anything outside the brief itself — the caller appends machine-readable data separately. " +
  "Output Markdown only — no code fences, no prose commentary.";

// Shape passed to the model. Kept deliberately compact so the
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
// the exact shape the model sees, and so a future "generate a
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
// return the markdown body. Retained as a test-callable helper
// that documents the envelope shape; the production path goes
// through `backend.generate` (text-envelope mode), which
// extracts `result` itself.
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

// Build the production SummarizeFn. `isoDate` is captured once
// per pipeline run so every call in that run uses the same date
// header (even if the run crosses midnight).
export function makeDefaultSummarize(isoDate: string): SummarizeFn {
  return async (items) => {
    if (items.length === 0) return buildEmptyDayMarkdown(isoDate);
    const userPrompt = buildSummarizePromptBody(items, isoDate);
    return getActiveBackend().generate({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      profile: "source-summarize",
    });
  };
}
