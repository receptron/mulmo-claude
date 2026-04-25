// Data shapes, prompts, and validators for the journal archivist.
// Pure module — no IO, no subprocess, no global state. The CLI
// transport (subprocess wrapper, error classes, default Summarize)
// lives in `./archivist-cli.ts`.
//
// Splitting these used to be one file (`archivist.ts`), but it had
// grown to 386 lines mixing transport with schemas. Keeping prompts
// + validators separate lets tests / future passes import the data
// shapes without dragging in `node:child_process`.

import { isRecord } from "../../utils/types.js";

// --- Daily archivist contract ---------------------------------------

export interface SessionEventExcerpt {
  source: string; // "user" | "assistant" | "tool" | ...
  type: string; // "text" | "tool_result" | ...
  // One-line human-readable rendering of the event, already
  // truncated to a sane length by the caller.
  content: string;
}

export interface SessionExcerpt {
  sessionId: string;
  roleId: string;
  events: SessionEventExcerpt[];
  // Workspace-relative file paths produced by the session's tool
  // calls (e.g. "stories/foo.json", "HTMLs/bar.html",
  // "wiki/pages/baz.md"). Surfaced so the archivist can emit
  // navigable markdown links to them in the summaries.
  artifactPaths: string[];
}

export interface ExistingTopicSnapshot {
  slug: string;
  content: string;
}

export interface DailyArchivistInput {
  date: string; // YYYY-MM-DD
  existingDailySummary: string | null;
  existingTopicSummaries: ExistingTopicSnapshot[];
  sessionExcerpts: SessionExcerpt[];
}

export type TopicUpdateAction = "create" | "append" | "rewrite";

export interface TopicUpdate {
  slug: string;
  action: TopicUpdateAction;
  content: string;
}

export interface DailyArchivistOutput {
  dailySummaryMarkdown: string;
  topicUpdates: TopicUpdate[];
}

// System prompt for the daily pass. Written long-form because the
// model does a much better job with explicit rules and an example
// than with a terse instruction.
export const DAILY_SYSTEM_PROMPT = `You are the journal archivist for a personal MulmoClaude workspace.
Your job: given raw session excerpts for a single day, produce
(1) a daily summary and (2) updates to long-running topic notes.

OUTPUT FORMAT
You must emit a single JSON object wrapped in a \`\`\`json code fence.
Schema:
{
  "dailySummaryMarkdown": "...",
  "topicUpdates": [
    { "slug": "kebab-case-slug", "action": "create" | "append" | "rewrite", "content": "..." }
  ]
}
No prose outside the fence. No extra keys.

DAILY SUMMARY RULES
- Write in the same language as the source sessions. Japanese stays Japanese. English stays English.
- Start with a top-level \`# <date>\` heading using the date passed in.
- Use short bullet sections per theme or per session, not a prose wall.
- If an existing daily summary was provided, treat it as a prior draft to REWRITE, not append to — your output replaces it entirely.
- Be terse. Facts and decisions only, no filler.

TOPIC UPDATE RULES
- Prefer the existing topic list. Only invent a new slug if nothing fits.
- Slugs are lowercase kebab-case ASCII (e.g. "video-generation"). No spaces, no unicode.
- Use \`append\` for incremental facts: your content will be concatenated to the existing topic file after a blank line.
- Use \`create\` only when the slug is new.
- Use \`rewrite\` sparingly — only when the existing topic has become incoherent and needs a full replacement.
- If a session has no clear topical hook, emit zero topic updates rather than forcing one.

ARTIFACT LINKS
- The prompt may list "ARTIFACTS REFERENCED" — workspace-relative paths produced by the day's sessions (e.g. \`stories/foo.json\`, \`wiki/pages/bar.md\`, \`HTMLs/baz.html\`).
- When your summary mentions one of those artifacts, embed a markdown link to it using a **workspace-absolute path** beginning with a single forward slash.
  - Correct:   \`[wiki page on X](/wiki/pages/x.md)\`
  - Wrong:     \`[wiki page](wiki/pages/x.md)\` (missing leading slash)
  - Wrong:     \`[wiki page](/home/user/.../x.md)\` (filesystem absolute)
- The post-processor converts these to true relative paths before writing the file to disk, so don't do the relative-path math yourself.
- Only link to artifacts listed in "ARTIFACTS REFERENCED". Don't invent paths.

SESSION LINKS
- When your summary refers to a specific session (the ones listed under "SESSION EXCERPTS" with their \`session <id>\` header), link to that session using \`/chat/<sessionId>.jsonl\`.
  - Example: "— discussed in [session 550e8400](/chat/550e8400-e29b-41d4-a716-446655440000.jsonl)"
- The file viewer recognises this pattern and switches the sidebar chat to that session when the link is clicked, so the reader can pick up where the session left off.
- You do not have to link every session you mention, but linking at least the first reference per session is helpful.

LANGUAGE
- Match the language of the source sessions. Always.`;

// Build the user-side prompt for one day's worth of content.
// Pure string construction — safe to unit test if we ever want to.
export function buildDailyUserPrompt(input: DailyArchivistInput): string {
  const parts: string[] = [];
  parts.push(`DATE: ${input.date}`);
  parts.push("");

  if (input.existingDailySummary !== null) {
    parts.push("EXISTING DAILY SUMMARY (replace this with your new version):");
    parts.push("```md");
    parts.push(input.existingDailySummary);
    parts.push("```");
    parts.push("");
  }

  parts.push("EXISTING TOPICS:");
  if (input.existingTopicSummaries.length === 0) {
    parts.push("(none yet)");
  } else {
    for (const topicSummary of input.existingTopicSummaries) {
      parts.push(`- ${topicSummary.slug}`);
    }
  }
  parts.push("");

  // Union of all workspace-relative artifact paths the day's
  // sessions produced, deduped and sorted. Given to the archivist
  // so it can link to them from the summary text.
  const allArtifacts = new Set<string>();
  for (const sessionExcerpt of input.sessionExcerpts) {
    for (const artifactPath of sessionExcerpt.artifactPaths) allArtifacts.add(artifactPath);
  }
  parts.push("ARTIFACTS REFERENCED:");
  if (allArtifacts.size === 0) {
    parts.push("(none)");
  } else {
    for (const artifactPath of [...allArtifacts].sort()) {
      parts.push(`- ${artifactPath}`);
    }
  }
  parts.push("");

  parts.push("SESSION EXCERPTS:");
  for (const sessionExcerpt of input.sessionExcerpts) {
    parts.push(`### session ${sessionExcerpt.sessionId} (role: ${sessionExcerpt.roleId})`);
    for (const eventExcerpt of sessionExcerpt.events) {
      parts.push(`- [${eventExcerpt.source}/${eventExcerpt.type}] ${eventExcerpt.content}`);
    }
    parts.push("");
  }

  parts.push("Produce the JSON described in the system prompt now.");
  return parts.join("\n");
}

// --- Optimization archivist contract --------------------------------

export interface OptimizationTopicSnapshot {
  slug: string;
  // First ~500 chars of the topic file, enough for the model to
  // judge similarity without blowing up prompt size.
  headContent: string;
}

export interface OptimizationInput {
  topics: OptimizationTopicSnapshot[];
}

export interface TopicMerge {
  from: string[];
  into: string;
  newContent: string;
}

export interface OptimizationOutput {
  merges: TopicMerge[];
  archives: string[];
}

export const OPTIMIZATION_SYSTEM_PROMPT = `You are the journal optimizer for a personal MulmoClaude workspace.
Your job: review the current topic list and decide which topics should be merged together and which should be archived.

OUTPUT FORMAT
A single JSON object wrapped in a \`\`\`json code fence:
{
  "merges": [
    { "from": ["slug-a", "slug-b"], "into": "merged-slug", "newContent": "..." }
  ],
  "archives": ["stale-slug"]
}
No prose outside the fence.

MERGE RULES
- Only merge topics that are clearly duplicates or near-duplicates (e.g. "video-gen" and "video-generation").
- "into" may be one of the "from" slugs (keeping an existing file) or a brand-new slug (creating a new file).
- "newContent" is the full replacement body for the target file, in markdown.
- Be conservative: if in doubt, leave things alone.

ARCHIVE RULES
- Archive only topics that look stale AND uninteresting. Err on the side of keeping things.
- Do not archive a topic you also listed in a merge's "from" — the merge already moves it.

LANGUAGE
- Match the language of the source content for "newContent".
- If no changes are needed, return \`{ "merges": [], "archives": [] }\`. That is a valid and expected outcome.`;

export function buildOptimizationUserPrompt(input: OptimizationInput): string {
  const parts: string[] = [];
  parts.push("CURRENT TOPICS:");
  for (const topic of input.topics) {
    parts.push(`### ${topic.slug}`);
    parts.push("```md");
    parts.push(topic.headContent);
    parts.push("```");
    parts.push("");
  }
  parts.push("Produce the JSON described in the system prompt now.");
  return parts.join("\n");
}

// --- JSON extraction ------------------------------------------------

// Tolerant JSON extractor: prefers a ```json fenced block; falls back
// to scanning for the first balanced `{ ... }` block. Returns `null`
// on failure so callers can log-and-skip instead of crash.
//
// JSON extraction helpers moved to server/utils/json.ts.
// Re-export here so journal callers (and existing tests) keep a
// single import surface for the archivist contract.
export { extractJsonObject, findBalancedBraceBlock } from "../../utils/json.js";

// --- Validators ------------------------------------------------------

// Type guards used by callers to validate parsed output. Written as
// guards rather than `as` casts per project conventions.
export function isDailyArchivistOutput(value: unknown): value is DailyArchivistOutput {
  if (!isRecord(value)) return false;
  const recordValue = value as Record<string, unknown>;
  if (typeof recordValue.dailySummaryMarkdown !== "string") return false;
  if (!Array.isArray(recordValue.topicUpdates)) return false;
  return recordValue.topicUpdates.every(isTopicUpdate);
}

function isTopicUpdate(value: unknown): value is TopicUpdate {
  if (!isRecord(value)) return false;
  const recordValue = value as Record<string, unknown>;
  if (typeof recordValue.slug !== "string") return false;
  if (typeof recordValue.content !== "string") return false;
  return recordValue.action === "create" || recordValue.action === "append" || recordValue.action === "rewrite";
}

export function isOptimizationOutput(value: unknown): value is OptimizationOutput {
  if (!isRecord(value)) return false;
  const recordValue = value as Record<string, unknown>;
  if (!Array.isArray(recordValue.merges)) return false;
  if (!Array.isArray(recordValue.archives)) return false;
  if (!recordValue.merges.every(isTopicMerge)) return false;
  return recordValue.archives.every((archiveSlug: unknown) => typeof archiveSlug === "string");
}

function isTopicMerge(value: unknown): value is TopicMerge {
  if (!isRecord(value)) return false;
  const recordValue = value as Record<string, unknown>;
  if (!Array.isArray(recordValue.from)) return false;
  if (!recordValue.from.every((fromSlug: unknown) => typeof fromSlug === "string")) return false;
  if (typeof recordValue.into !== "string") return false;
  if (typeof recordValue.newContent !== "string") return false;
  return true;
}
