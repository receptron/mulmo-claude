// LLM-backed `MemoryClassifier` for the legacy-memory migration
// (#1029 PR-B). Asks Claude to look at a single legacy bullet plus
// its surrounding H2 section header and produce a JSON verdict
// `{type, description}`. The four types and their meaning live in
// the system prompt so the LLM can pick consistently across
// candidates.
//
// The function is intentionally one-call-per-candidate (not a batch
// classify): batching saves tokens but couples failures together, so
// a single malformed verdict could poison the whole batch. Migration
// is one-time and small — keep the request shape simple.

import type { MemoryClassification, MemoryCandidate, MemoryClassifier } from "./migrate.js";
import { isMemoryType, type MemoryType } from "./types.js";

import type { Summarize } from "../journal/archivist-cli.js";
import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";

const SYSTEM_PROMPT = `You are classifying a single bullet from a personal-memory file into one of four types.

Types:
- preference: a durable habit, preference, or convention that does not change over time. Examples: "uses yarn (npm not allowed)", "prefers Emacs", "writes commit messages in English".
- interest: a topic, hobby, or domain the user follows over a long horizon. Examples: "AI research papers", "robotics", "Impressionist painting".
- fact: a concrete personal fact that COULD become stale. Examples: "planning a trip to Egypt", "owns a toaster oven", "currently working on BootCamp project".
- reference: a pointer to an internal/external resource (path, dashboard, recurring task id, repo URL). Examples: "main repo at ~/ss/llm/mulmoclaude4", "weekly art-exhibitions-watch task".

Rules:
- Output ONE compact JSON object. No prose, no markdown, no code fences. Output literal JSON only.
- Schema: {"type":"<one of preference|interest|fact|reference>","description":"<short single-line description, <=100 chars>"}
- The description is for an index file. Keep it short and informative — strip filler, don't repeat the bullet verbatim.
- If the bullet is too vague to classify, output: null
- Never invent fields. Output exactly the schema above or null.`;

interface DepsForLlmClassifier {
  /** Same Summarize callback used by `journal/dailyPass`. The
   *  classifier feeds it the system prompt + a single-bullet user
   *  prompt and parses the JSON reply. */
  summarize: Summarize;
}

export function makeLlmMemoryClassifier(deps: DepsForLlmClassifier): MemoryClassifier {
  return async (candidate: MemoryCandidate) => {
    const userPrompt = buildUserPrompt(candidate);
    let raw: string;
    try {
      raw = await deps.summarize(SYSTEM_PROMPT, userPrompt);
    } catch (err) {
      log.warn("memory", "llm classifier: summarize threw", {
        preview: candidate.body.slice(0, 80),
        error: errorMessage(err),
      });
      return null;
    }
    return parseClassifierVerdict(raw);
  };
}

function buildUserPrompt(candidate: MemoryCandidate): string {
  const sectionLine = candidate.section ? `Section header: ${candidate.section}` : "Section header: (none)";
  return [sectionLine, `Bullet: ${candidate.body}`, "", "Output JSON only."].join("\n");
}

// Tolerant JSON extraction — Claude occasionally wraps the verdict in
// a code fence or adds a leading word despite the prompt ban. Strip
// surrounding fences and pick out the first `{...}` block (or a bare
// `null`) before parsing.
export function parseClassifierVerdict(raw: string): MemoryClassification | null {
  const trimmed = stripFenceAndWhitespace(raw);
  if (trimmed === "null") return null;
  const objectText = extractFirstObject(trimmed);
  if (!objectText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(objectText);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const { type, description } = parsed as { type?: unknown; description?: unknown };
  if (!isMemoryType(type)) return null;
  const desc = typeof description === "string" ? description.trim() : "";
  // The description is optional from the spec's perspective —
  // migrate.ts falls back to a body-derived description when missing.
  // But if present, normalise to a single line and cap length.
  return desc.length > 0 ? { type: type as MemoryType, description: oneLine(desc).slice(0, 200) } : { type: type as MemoryType };
}

function stripFenceAndWhitespace(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    const firstNl = text.indexOf("\n");
    if (firstNl >= 0) text = text.slice(firstNl + 1);
    if (text.endsWith("```")) text = text.slice(0, -3);
  }
  return text.trim();
}

function extractFirstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index = skipStringBody(text, index + 1);
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
    index += 1;
  }
  return null;
}

// Returns the index immediately after the closing `"`, or `text.length`
// if the string is unterminated. Backslash escapes the next char so
// `\"` does not close the string.
function skipStringBody(text: string, fromIndex: number): number {
  let index = fromIndex;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') return index + 1;
    index += 1;
  }
  return text.length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
