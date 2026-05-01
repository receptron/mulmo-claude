// LLM-driven clusterer that turns a flat list of legacy atomic
// entries into a `<type, topic> → bullets[]` mapping (#1070 PR-A).
// Library only — `topic-migrate` is the one that calls it and writes
// to staging. The clusterer is pure async function shape so tests
// can substitute a deterministic stub without touching the LLM.

import { errorMessage } from "../../utils/errors.js";
import { log } from "../../system/logger/index.js";
import type { Summarize } from "../journal/archivist-cli.js";
import type { MemoryEntry, MemoryType } from "./types.js";
import { isMemoryType } from "./types.js";
import { isSafeTopicSlug, slugifyTopicName } from "./topic-types.js";

export interface ClusterTopic {
  /** Topic slug (filename without `.md`). Must pass `isSafeTopicSlug`. */
  topic: string;
  /** Optional H2 sub-categorisation. When empty, bullets sit under the
   *  H1 directly. */
  sections?: ClusterSection[];
  /** Bullets that don't fit any section. They land directly under H1
   *  ahead of any sectioned content. */
  unsectionedBullets?: string[];
}

export interface ClusterSection {
  /** H2 heading text (e.g. "Rock / Metal"). */
  heading: string;
  /** Bullet bodies. Order is preserved. */
  bullets: string[];
}

export type ClusterMap = Record<MemoryType, ClusterTopic[]>;

export type MemoryClusterer = (entries: readonly MemoryEntry[]) => Promise<ClusterMap | null>;

const CLUSTER_SYSTEM_PROMPT = `You group personal-memory bullets into topic files for long-term storage.

Input: a JSON array of bullets. Each has \`type\` (preference / interest / fact / reference), \`name\` (one-line label), and \`body\` (the raw bullet text).

Task: cluster the bullets by type and topic.

- Each \`type\` (preference / interest / fact / reference) gets its own section in the output.
- Within a type, group bullets that share a subject into one topic. Topic names are short, lowercase ASCII slugs (e.g. "music", "art", "ai-research", "travel", "bootcamp", "dev", "food", "tasks", "paths"). Pick names that are descriptive of the cluster.
- Inside a topic, you MAY further sub-categorise via H2 sections (e.g. \`music\` → "Rock / Metal", "Punk / Melodic"). Sections are optional — small topics with a handful of bullets can skip them and leave \`unsectionedBullets\`.
- Keep bullets verbatim. Do NOT edit, paraphrase, summarise, or merge bullets. The output must be losslessly reconstructable.
- Place each bullet into exactly ONE topic. No duplication across topics.
- Aim for ~5–15 topic files per type. Avoid singletons unless the bullet has no peers.

Output: ONE JSON object only, no prose, no markdown fences. Schema:

{
  "preference": [
    { "topic": "<slug>", "sections": [ { "heading": "<H2 text>", "bullets": ["...", "..."] } ], "unsectionedBullets": ["..."] }
  ],
  "interest":  [ ... ],
  "fact":      [ ... ],
  "reference": [ ... ]
}

\`sections\` and \`unsectionedBullets\` are both optional per topic. Empty arrays are also OK. Every type key must be present even if its array is empty.`;

export interface MakeClustererDeps {
  summarize: Summarize;
}

export function makeLlmMemoryClusterer(deps: MakeClustererDeps): MemoryClusterer {
  return async (entries) => {
    if (entries.length === 0) {
      return { preference: [], interest: [], fact: [], reference: [] };
    }
    const userPrompt = buildUserPrompt(entries);
    let raw: string;
    try {
      raw = await deps.summarize(CLUSTER_SYSTEM_PROMPT, userPrompt);
    } catch (err) {
      log.warn("memory", "cluster: summarize threw", { error: errorMessage(err) });
      return null;
    }
    return parseClusterMap(raw);
  };
}

function buildUserPrompt(entries: readonly MemoryEntry[]): string {
  const payload = entries.map((entry) => ({ type: entry.type, name: entry.name, body: entry.body }));
  return `${entries.length} bullets to cluster:\n\n${JSON.stringify(payload, null, 2)}`;
}

// Tolerant parser: strips fences, picks the first balanced object,
// validates schema, normalises slugs. Bullets with unknown types or
// missing topics are dropped (logged so the migration's count of
// unaccounted-for entries is visible).
export function parseClusterMap(raw: string): ClusterMap | null {
  const stripped = stripFenceAndWhitespace(raw);
  const objectText = extractFirstObject(stripped);
  if (!objectText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(objectText);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const out: ClusterMap = { preference: [], interest: [], fact: [], reference: [] };
  for (const type of ["preference", "interest", "fact", "reference"] as const) {
    const list = (parsed as Record<string, unknown>)[type];
    if (!Array.isArray(list)) continue;
    for (const candidate of list) {
      const topic = normaliseTopic(candidate);
      if (topic) out[type].push(topic);
    }
  }
  return out;
}

function normaliseTopic(value: unknown): ClusterTopic | null {
  if (!isPlainObject(value)) return null;
  const obj = value as Record<string, unknown>;
  const slug = resolveTopicSlug(obj.topic);
  if (!slug) return null;
  const sections = normaliseSections(obj.sections);
  const unsectionedBullets = normaliseBulletList(obj.unsectionedBullets);
  if (sections.length === 0 && unsectionedBullets.length === 0) return null;
  return {
    topic: slug,
    ...(sections.length > 0 ? { sections } : {}),
    ...(unsectionedBullets.length > 0 ? { unsectionedBullets } : {}),
  };
}

function resolveTopicSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (isSafeTopicSlug(value)) return value;
  const slugified = slugifyTopicName(value);
  return slugified && isSafeTopicSlug(slugified) ? slugified : null;
}

function normaliseSections(value: unknown): ClusterSection[] {
  if (!Array.isArray(value)) return [];
  const out: ClusterSection[] = [];
  for (const candidate of value) {
    const section = normaliseSection(candidate);
    if (section) out.push(section);
  }
  return out;
}

function normaliseBulletList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((bullet): bullet is string => typeof bullet === "string" && bullet.trim().length > 0);
}

function normaliseSection(value: unknown): ClusterSection | null {
  if (!isPlainObject(value)) return null;
  const obj = value as Record<string, unknown>;
  const heading = typeof obj.heading === "string" ? obj.heading.trim() : "";
  if (heading.length === 0) return null;
  if (!Array.isArray(obj.bullets)) return null;
  const bullets = obj.bullets.filter((bullet): bullet is string => typeof bullet === "string" && bullet.trim().length > 0);
  if (bullets.length === 0) return null;
  return { heading, bullets };
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

// Re-exported so migrate.ts can validate the clusterer's output
// shape before writing.
export { isMemoryType };
