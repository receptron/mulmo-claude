// Extracts durable user facts from chat session excerpts and
// appends them to memory.md. Called at the end of the journal
// daily pass so new facts are picked up even if the agent didn't
// write them during the conversation.
//
// Only appends facts that aren't already in memory.md — the LLM
// receives the current memory content as context and is instructed
// to return ONLY new facts.

import { readFileSync, existsSync } from "fs";
import path from "path";
import { WORKSPACE_FILES } from "../paths.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { log } from "../../system/logger/index.js";
import { ClaudeCliNotFoundError } from "./archivist.js";

const EXTRACTION_SYSTEM_PROMPT = `You are a personal-fact extractor. Given a batch of chat excerpts between a user and an AI assistant, extract ONLY durable facts about the USER — things that would still be true next week.

Categories to look for:
- Food preferences (likes, dislikes, allergies, diet)
- Daily routines & habits (exercise, hobbies, recurring activities)
- Possessions (car, devices, tools)
- Family & pets (members, names, ages)
- Location (city, commute, travel patterns)
- Interests & hobbies (topics they follow, activities)
- Schedule patterns (weekly meetings, monthly tasks)
- Health (conditions, habits)
- Work (job, role, company, work style)
- Coding preferences (tools, conventions, style preferences)
- Communication style (language, verbosity, formality)

Rules:
- Extract ONLY what the user explicitly stated — never infer or guess.
- Each fact should be one concise bullet point.
- If the user corrected a previous fact, output the corrected version only.
- Do NOT extract facts about the AI, the app, or technical implementation details.
- Do NOT extract ephemeral information (today's weather, a specific bug being debugged).
- Output ONLY the bullet points, one per line, prefixed with "- ". No headers, no categories, no explanation.
- If there are no new user facts, output exactly: NONE`;

export interface MemoryExtractionDeps {
  workspaceRoot: string;
  /** The excerpts from today's dirty sessions, concatenated. */
  excerpts: string;
  /** Spawns claude CLI and returns stdout. Injectable for tests. */
  summarize: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

/**
 * Extract new user facts from chat excerpts and append to memory.md.
 * Returns the number of facts appended (0 if none found or on error).
 */
export async function extractAndAppendMemory(
  deps: MemoryExtractionDeps,
): Promise<number> {
  const memoryPath = path.join(deps.workspaceRoot, WORKSPACE_FILES.memory);
  const existingMemory = existsSync(memoryPath)
    ? readFileSync(memoryPath, "utf-8")
    : "";

  const userPrompt = buildUserPrompt(existingMemory, deps.excerpts);
  let raw: string;
  try {
    raw = await deps.summarize(EXTRACTION_SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) throw err;
    log.warn("memory-extractor", "LLM call failed", {
      error: String(err),
    });
    return 0;
  }

  const newFacts = parseExtractedFacts(raw);
  if (newFacts.length === 0) return 0;

  const factsToAppend = filterNewFacts(existingMemory, newFacts);
  if (factsToAppend.length === 0) return 0;

  const updatedContent = appendFacts(existingMemory, factsToAppend);
  await writeFileAtomic(memoryPath, updatedContent);
  log.info("memory-extractor", "appended new facts", {
    count: factsToAppend.length,
  });
  return factsToAppend.length;
}

/** Build the user prompt with existing memory + new excerpts. */
export function buildUserPrompt(
  existingMemory: string,
  excerpts: string,
): string {
  const parts: string[] = [];
  if (existingMemory.trim()) {
    parts.push("## Already known (do NOT repeat these):\n\n" + existingMemory);
  }
  parts.push("## New chat excerpts:\n\n" + excerpts);
  parts.push(
    "\nExtract any NEW user facts not already in the 'Already known' section above. If none, output: NONE",
  );
  return parts.join("\n\n");
}

/** Parse LLM output into a list of fact strings. */
export function parseExtractedFacts(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "NONE" || trimmed === "") return [];
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .filter((line) => line.length > 3);
}

function normalizeFact(fact: string): string {
  return fact.replace(/^- /, "").trim().toLowerCase();
}

/** Remove facts that already exist in the current memory content. */
export function filterNewFacts(
  existingMemory: string,
  facts: readonly string[],
): string[] {
  const seen = new Set(parseExtractedFacts(existingMemory).map(normalizeFact));
  const out: string[] = [];
  for (const fact of facts) {
    const key = normalizeFact(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
}

/** Append facts to existing memory content. */
export function appendFacts(existing: string, facts: string[]): string {
  const trimmed = existing.trimEnd();
  const factsBlock = facts.join("\n");
  if (!trimmed) {
    return `# Memory\n\nDistilled facts about you and your work.\n\n${factsBlock}\n`;
  }
  return `${trimmed}\n${factsBlock}\n`;
}
