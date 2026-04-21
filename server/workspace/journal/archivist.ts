// Thin wrapper around the Claude Code CLI used as the journal's
// summarizer. The default `runClaudeCli` spawns `claude -p` as a
// subprocess so summarization draws from the user's subscription
// quota rather than the API key budget.
//
// The rest of the journal module receives a `Summarize` function
// via dependency injection — tests supply a deterministic fake, the
// production path supplies `runClaudeCli`.

import { spawn } from "node:child_process";
import { CLI_SUBPROCESS_TIMEOUT_MS } from "../../utils/time.js";

// (systemPrompt, userPrompt) → raw model output as a string.
// The daily/optimization passes parse JSON out of the string
// themselves; this layer stays transport-only.
export type Summarize = (systemPrompt: string, userPrompt: string) => Promise<string>;

// Wall-clock cap per CLI invocation. 5 minutes is comfortably above
// the worst-case summarization run we've seen and still short enough
// that a wedged subprocess doesn't tie up resources forever.
const CLI_TIMEOUT_MS = CLI_SUBPROCESS_TIMEOUT_MS;

// Sentinel we throw on ENOENT so maybeRunJournal can disable the
// feature for the rest of the server lifetime instead of retrying
// on every session-end.
export class ClaudeCliNotFoundError extends Error {
  constructor() {
    super("[journal] `claude` CLI is not available on PATH — journal disabled");
    this.name = "ClaudeCliNotFoundError";
  }
}

export class ClaudeCliFailedError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(exitCode: number | null, stderr: string) {
    super(`[journal] \`claude\` CLI exited ${exitCode ?? "(killed)"}: ${stderr.slice(0, 500)}`);
    this.name = "ClaudeCliFailedError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// Default summarizer. Spawns `claude -p` and pipes the combined
// system + user prompt to stdin so we don't hit shell-argv limits
// for large day excerpts.
export const runClaudeCli: Summarize = async (systemPrompt, userPrompt) => {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: Error & { code?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (err.code === "ENOENT") {
        reject(new ClaudeCliNotFoundError());
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timedOut) {
        reject(new ClaudeCliFailedError(null, `timed out after ${CLI_TIMEOUT_MS}ms\n${stderr}`));
        return;
      }
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new ClaudeCliFailedError(code, stderr));
      }
    });

    // Surface stdin write errors (e.g. EPIPE if the child exited
    // before we finished writing) instead of silently dropping them.
    child.stdin.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    // Send the full prompt in one write. If Node's stream layer
    // signals backpressure (write returns false), wait for "drain"
    // before calling end() so we don't close stdin while the buffer
    // still has data to flush. For typical archivist prompts this
    // path rarely fires, but very large session excerpts can reach
    // it.
    const payload = `${systemPrompt}\n\n---\n\n${userPrompt}`;
    const flushed = child.stdin.write(payload);
    if (flushed) {
      child.stdin.end();
    } else {
      child.stdin.once("drain", () => child.stdin.end());
    }
  });
};

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
// Re-export for backwards compatibility with callers that import
// from this module (dailyPass.ts, optimizationPass.ts).
export { extractJsonObject, findBalancedBraceBlock } from "../../utils/json.js";

import { isRecord } from "../../utils/types.js";

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
