// Auto-categorizer for newly-registered sources.
//
// When a user registers a new source, the UI / CLI calls
// `classifySource({ title, url, sampleTitles, sampleSummaries })`.
// The classifier spawns `claude` with a strict JSON schema that
// limits output to the fixed 25-slug taxonomy (see
// server/sources/taxonomy.ts), so the model can't invent
// `artificial-intelligence` when we already have `ai` — the whole
// point of the closed enum.
//
// Shape of the spawn layer mirrors `server/chat-index/summarizer.ts`
// so we reuse the "errors on stdout not stderr", "budget
// exhaustion surfaces cleanly" behaviour that we already got
// right once.
//
// Injection-friendly: production `classifySource` goes through
// `defaultClassify`. Tests pass their own `ClassifyFn` that
// skips the CLI entirely.

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { ClaudeCliNotFoundError } from "../journal/archivist.js";
import { formatSpawnFailure } from "../../utils/spawn.js";
import { ONE_MINUTE_MS } from "../../utils/time.js";
import { CATEGORY_SLUGS, normalizeCategories, type CategorySlug } from "./taxonomy.js";
import { errorMessage } from "../../utils/errors.js";
import { isRecord } from "../../utils/types.js";

// Structured input passed to the classifier. Kept small (not the
// full source content) so the prompt stays cheap — a couple of
// sample titles is enough for the model to tell "tech-news" from
// "culture".
export interface ClassifyInput {
  title: string;
  url: string;
  // Optional extra context from a sample fetch — the first few
  // item titles and (optionally) their summaries give the LLM
  // enough signal to distinguish subject matter. When the
  // pre-register handshake can't fetch yet (or the source is
  // brand new), these can be empty arrays.
  sampleTitles?: string[];
  sampleSummaries?: string[];
  // Optional human notes from the YAML frontmatter body — users
  // sometimes describe why they registered the source.
  notes?: string;
}

export interface ClassifyResult {
  // 1-5 slugs from CATEGORY_SLUGS. Order matches model output
  // (usually "most specific → most general"). Always validated
  // through `normalizeCategories` so a hallucinated slug never
  // leaks into the registry.
  categories: CategorySlug[];
  // Model's free-text one-line explanation — stored in the source
  // file's notes body for human review.
  rationale: string;
}

// Injection point for tests: any function matching this
// signature is accepted by `classifySource`. Production passes
// `defaultClassify`.
export type ClassifyFn = (input: ClassifyInput) => Promise<ClassifyResult>;

// Max time we let `claude` run during registration. Registration
// is a foreground user action, so anything longer than 2 min is
// effectively broken anyway.
export const DEFAULT_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

// Budget cap. Classification is one small call per source (once
// at registration, rarely re-classified) so $0.05 is fine — we
// don't pay the first-call cache-creation cost on every source
// because we warm it once and reuse.
const MAX_BUDGET_USD = 0.05;

const SYSTEM_PROMPT =
  "You classify an information source (RSS feed, GitHub repo, web site, etc.) into a fixed taxonomy. " +
  "You MUST pick between 1 and 5 categories from the provided enum — no synonyms, no new slugs, no invented labels. " +
  "Choose the most specific matches first, then add broader ones only if they add signal. " +
  "Output strict JSON matching the provided schema. Respond with structured output only.";

// The category enum is inlined into the prompt schema so the
// model sees the exact list of allowed values. Kept as a readonly
// array so mutations at runtime are impossible.
function classifySchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["categories", "rationale"],
    properties: {
      categories: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: { type: "string", enum: [...CATEGORY_SLUGS] },
      },
      rationale: {
        type: "string",
        maxLength: 200,
      },
    },
  };
}

// Build the user-prompt text from the structured input. Pure —
// exported so tests can pin the shape of what the model sees.
export function buildClassifyPrompt(input: ClassifyInput): string {
  const lines: string[] = [];
  lines.push(`TITLE: ${input.title}`);
  lines.push(`URL: ${input.url}`);
  if (input.notes && input.notes.trim().length > 0) {
    lines.push("");
    lines.push("USER NOTES:");
    lines.push(input.notes.trim().slice(0, 400));
  }
  const titles = input.sampleTitles ?? [];
  if (titles.length > 0) {
    lines.push("");
    lines.push("RECENT ITEM TITLES:");
    for (const title of titles.slice(0, 5)) {
      lines.push(`- ${title}`);
    }
  }
  const summaries = input.sampleSummaries ?? [];
  if (summaries.length > 0) {
    lines.push("");
    lines.push("RECENT ITEM SUMMARIES:");
    for (const summary of summaries.slice(0, 3)) {
      // One-line truncation so a single long abstract doesn't
      // dominate the prompt budget.
      lines.push(`- ${summary.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  return lines.join("\n");
}

interface ClaudeJsonResult {
  type?: string;
  is_error?: boolean;
  structured_output?: unknown;
  result?: string;
}

// Pure: parse the claude `--output-format json` envelope and
// validate against our result shape. Exported so tests cover the
// envelope-handling + normalization paths without spawning CLI.
export function parseClassifyOutput(stdout: string): ClassifyResult {
  let parsed: ClaudeJsonResult;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(`[sources/classifier] failed to parse claude json: ${errorMessage(err)}`);
  }
  if (parsed.is_error) {
    throw new Error(`[sources/classifier] claude returned error: ${parsed.result ?? "unknown"}`);
  }
  return validateClassifyResult(parsed.structured_output);
}

// Runtime-validate the `structured_output` field into a
// ClassifyResult. Invalid categories are silently dropped
// (normalizeCategories filter); rationale falls back to empty
// string. Either the enum-constrained JSON schema OR this
// validator would catch a bad slug — defense-in-depth.
export function validateClassifyResult(obj: unknown): ClassifyResult {
  // Arrays are `typeof === "object"` but aren't a valid
  // structured_output shape — reject them explicitly so the
  // error message stays accurate.
  if (!isRecord(obj)) {
    throw new Error("[sources/classifier] output is not an object");
  }
  const record = obj as Record<string, unknown>;
  const categories = normalizeCategories(record.categories);
  if (categories.length === 0) {
    // The model is required to pick at least one (min_items=1 in
    // the schema). If we end up here, something went wrong upstream
    // — either the model ignored the schema or normalizeCategories
    // filtered every slug as invalid. Throw so the caller treats
    // the registration as failed rather than registering a source
    // with no categories.
    throw new Error("[sources/classifier] output has no valid categories from the taxonomy");
  }
  const rationale = typeof record.rationale === "string" ? record.rationale.slice(0, 400) : "";
  return { categories, rationale };
}

// --- spawn layer --------------------------------------------------------

function spawnClaudeClassify(userPrompt: string, timeoutMs: number): Promise<string> {
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
      JSON.stringify(classifySchema()),
      "--system-prompt",
      SYSTEM_PROMPT,
      "-p",
      userPrompt,
    ];
    // Run from tmpdir so claude doesn't load the project's
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
      reject(new Error(`[sources/classifier] claude timed out after ${timeoutMs}ms`));
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
        // claude writes structured errors (incl.
        // error_max_budget_usd) to STDOUT in JSON form — same
        // lesson we learned in chat-index/summarizer. Prefer the
        // structured message when we can parse it.
        reject(new Error(formatSpawnFailure("[sources/classifier]", code, stdout, stderr)));
        return;
      }
      resolve(stdout);
    });
  });
}

// Production ClassifyFn — spawns the real claude CLI.
export const defaultClassify: ClassifyFn = async (input) => {
  const userPrompt = buildClassifyPrompt(input);
  const stdout = await spawnClaudeClassify(userPrompt, DEFAULT_TIMEOUT_MS);
  return parseClassifyOutput(stdout);
};

// Public entry. Thin wrapper so tests can inject a ClassifyFn
// without reaching into spawn internals, and the call site in
// the manageSource plugin / pipeline stays a single symbol.
export async function classifySource(input: ClassifyInput, classify: ClassifyFn = defaultClassify): Promise<ClassifyResult> {
  return classify(input);
}
