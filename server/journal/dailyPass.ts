// The daily pass: walk chat/*.jsonl, find sessions changed since
// the last run, bucket events by local-date, call the archivist
// once per affected day, and apply its output (write daily/*.md,
// create/append/rewrite topics/*.md).
//
// This file is the only one in the journal module that combines
// filesystem side-effects with LLM calls. Pure bits (event parsing,
// bucketing) are factored into small exported helpers so tests can
// exercise them without touching disk.

import fsp from "node:fs/promises";
import path from "node:path";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import {
  type Summarize,
  type SessionExcerpt,
  type SessionEventExcerpt,
  type ExistingTopicSnapshot,
  type DailyArchivistInput,
  type TopicUpdate,
  DAILY_SYSTEM_PROMPT,
  buildDailyUserPrompt,
  extractJsonObject,
  isDailyArchivistOutput,
  ClaudeCliNotFoundError,
} from "./archivist.js";
import {
  summariesRoot,
  dailyPathFor,
  topicPathFor,
  toIsoDate,
  slugify,
  TOPICS_DIR,
} from "./paths.js";
import {
  findDirtySessions,
  applyProcessed,
  type SessionFileMeta,
} from "./diff.js";
import { rewriteWorkspaceLinks } from "./linkRewrite.js";
import { writeState, type JournalState } from "./state.js";

// --- Constants ------------------------------------------------------

// Per-event content is truncated before handing to the archivist so
// an accidentally huge tool result (e.g. base64 image data) doesn't
// blow past the CLI's context window.
const MAX_EVENT_CONTENT_CHARS = 600;

// Hard cap on events per session included in the prompt. Sessions
// with thousands of events get their head kept — the archivist can
// generally get the gist from the opening.
const MAX_EVENTS_PER_SESSION = 80;

// --- Public entry ---------------------------------------------------

export interface DailyPassDeps {
  workspaceRoot?: string;
  summarize: Summarize;
  // Active session ids to skip (mid-write). Caller passes the
  // live session registry to avoid ingesting jsonl files that the
  // agent is still appending to.
  activeSessionIds: ReadonlySet<string>;
}

export interface DailyPassResult {
  daysTouched: string[]; // YYYY-MM-DD values actually written
  sessionsIngested: string[];
  topicsCreated: string[];
  topicsUpdated: string[];
  skipped: Array<{ date: string; reason: string }>;
}

export async function runDailyPass(
  state: JournalState,
  deps: DailyPassDeps,
): Promise<{ nextState: JournalState; result: DailyPassResult }> {
  const workspaceRoot = deps.workspaceRoot ?? defaultWorkspacePath;
  const chatDir = path.join(workspaceRoot, "chat");
  const result: DailyPassResult = {
    daysTouched: [],
    sessionsIngested: [],
    topicsCreated: [],
    topicsUpdated: [],
    skipped: [],
  };

  const currentMetas = await listSessionMetas(chatDir);
  // Skip sessions the agent is currently writing to.
  const eligible = currentMetas.filter((m) => !deps.activeSessionIds.has(m.id));

  const { dirty } = findDirtySessions(eligible, state.processedSessions);
  if (dirty.length === 0) {
    return { nextState: { ...state }, result };
  }

  // Load the dirty sessions and bucket every event by its local date.
  const dayBuckets = new Map<string, SessionExcerpt[]>();
  const dirtyMetaById = new Map(eligible.map((m) => [m.id, m]));

  for (const sessionId of dirty) {
    try {
      const excerpts = await loadSessionExcerptsByDate(chatDir, sessionId);
      for (const [date, excerpt] of excerpts) {
        const bucket = dayBuckets.get(date) ?? [];
        bucket.push(excerpt);
        dayBuckets.set(date, bucket);
      }
    } catch (err) {
      // Malformed jsonl — skip this session, don't crash the pass.
      // eslint-disable-next-line no-console
      console.warn(`[journal] failed to load session ${sessionId}:`, err);
    }
  }

  // Read existing topic summaries once (shared across all day calls).
  const existingTopics = await readAllTopics(workspaceRoot);

  // Pre-compute: per-session, the set of days it contributes to.
  // We decrement this set as days succeed so we can mark a session
  // "fully processed" the moment its LAST day is written, and
  // persist that incrementally — a mid-run crash then only costs
  // the days written after the last checkpoint, not the whole pass.
  const sessionToDays = new Map<string, Set<string>>();
  for (const [date, bucket] of dayBuckets) {
    for (const excerpt of bucket) {
      let set = sessionToDays.get(excerpt.sessionId);
      if (!set) {
        set = new Set<string>();
        sessionToDays.set(excerpt.sessionId, set);
      }
      set.add(date);
    }
  }

  // `nextState` is mutated through the day loop and persisted after
  // each successful day via writeState (atomic tmp+rename). We do
  // NOT bump lastDailyRunAt here — that's the outer runner's job
  // after the whole pass (including optimization) finishes, so
  // partial progress doesn't look like a complete pass.
  const newTopicsSeen = new Set<string>(state.knownTopics);
  let nextState: JournalState = {
    ...state,
    knownTopics: [...newTopicsSeen].sort(),
  };

  // Process days in chronological order so topic state accumulates
  // naturally: an earlier day's update is visible to the next day.
  const orderedDays = [...dayBuckets.keys()].sort();

  for (const date of orderedDays) {
    const excerpts = dayBuckets.get(date) ?? [];
    const existingDaily = await readTextOrNull(
      dailyPathFor(workspaceRoot, date),
    );
    const input: DailyArchivistInput = {
      date,
      existingDailySummary: existingDaily,
      existingTopicSummaries: existingTopics,
      sessionExcerpts: excerpts,
    };

    let rawOutput: string;
    try {
      rawOutput = await deps.summarize(
        DAILY_SYSTEM_PROMPT,
        buildDailyUserPrompt(input),
      );
    } catch (err) {
      if (err instanceof ClaudeCliNotFoundError) {
        // Propagate so the outer runner can disable the feature.
        throw err;
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[journal] summarize failed for ${date}, skipping day:`,
        err,
      );
      result.skipped.push({ date, reason: "summarize failed" });
      continue;
    }

    const parsed = extractJsonObject(rawOutput);
    if (!isDailyArchivistOutput(parsed)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[journal] archivist returned unusable JSON for ${date}, skipping`,
      );
      result.skipped.push({ date, reason: "unusable archivist JSON" });
      continue;
    }

    // Rewrite any /workspace-absolute links in the archivist's output
    // into true-relative links from the daily summary's location
    // before writing to disk. Same treatment below for topic files.
    const [yearPart, monthPart, dayPart] = date.split("-");
    const dailyFileWsPath = `summaries/daily/${yearPart}/${monthPart}/${dayPart}.md`;
    const dailyContent = rewriteWorkspaceLinks(
      dailyFileWsPath,
      parsed.dailySummaryMarkdown,
    );
    await writeDailySummary(workspaceRoot, date, dailyContent);
    result.daysTouched.push(date);

    for (const update of parsed.topicUpdates) {
      const canonicalSlug = slugify(update.slug);
      const exists = existingTopics.some((t) => t.slug === canonicalSlug);
      const topicFileWsPath = path.posix.join(
        "summaries",
        "topics",
        `${canonicalSlug}.md`,
      );
      const normalized: TopicUpdate = {
        slug: canonicalSlug,
        // Guard: if the archivist asked to "append" to a slug that
        // doesn't exist yet, treat it as "create". Cheap defensive
        // handling that removes a whole class of LLM mistakes.
        action:
          !exists && update.action === "append" ? "create" : update.action,
        content: rewriteWorkspaceLinks(topicFileWsPath, update.content),
      };
      const outcome = await applyTopicUpdate(workspaceRoot, normalized);
      if (outcome === "created") result.topicsCreated.push(canonicalSlug);
      else if (outcome === "updated") result.topicsUpdated.push(canonicalSlug);
      newTopicsSeen.add(canonicalSlug);

      // Reflect the update in the in-memory topic snapshot so the
      // next day in this same pass sees the fresh content.
      const newBody = await readTextOrNull(
        topicPathFor(workspaceRoot, canonicalSlug),
      );
      if (newBody !== null) {
        const idx = existingTopics.findIndex((t) => t.slug === canonicalSlug);
        const snapshot: ExistingTopicSnapshot = {
          slug: canonicalSlug,
          content: newBody,
        };
        if (idx === -1) existingTopics.push(snapshot);
        else existingTopics[idx] = snapshot;
      }
    }

    // Per-day incremental state update. Sessions whose pending day
    // set just became empty are now fully processed and get their
    // record written. Sessions still carrying pending days stay
    // dirty so the next pass retries them if the loop is interrupted.
    const justCompleted: SessionFileMeta[] = [];
    for (const excerpt of excerpts) {
      const pending = sessionToDays.get(excerpt.sessionId);
      if (!pending) continue;
      pending.delete(date);
      if (pending.size === 0) {
        sessionToDays.delete(excerpt.sessionId);
        const meta = dirtyMetaById.get(excerpt.sessionId);
        if (meta) justCompleted.push(meta);
      }
    }
    if (justCompleted.length > 0) {
      result.sessionsIngested.push(...justCompleted.map((m) => m.id));
    }
    nextState = {
      ...nextState,
      processedSessions: applyProcessed(
        nextState.processedSessions,
        justCompleted,
      ),
      knownTopics: [...newTopicsSeen].sort(),
    };
    // Persist after every day. The atomic tmp+rename inside
    // writeState means a crash mid-write can't corrupt state.json,
    // and everything up to and including `date` is safely
    // committed: the next run picks up exactly from the next day.
    try {
      await writeState(workspaceRoot, nextState);
    } catch (err) {
      // A write failure is not fatal for the pass itself — we've
      // already written the day's markdown — but we want it loud
      // in the logs so a broken filesystem doesn't hide.
      // eslint-disable-next-line no-console
      console.warn(`[journal] failed to persist state after ${date}:`, err);
    }
  }

  return { nextState, result };
}

// --- Filesystem helpers ---------------------------------------------

async function listSessionMetas(chatDir: string): Promise<SessionFileMeta[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(chatDir);
  } catch {
    return [];
  }
  const out: SessionFileMeta[] = [];
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(chatDir, name);
    try {
      const st = await fsp.stat(full);
      out.push({
        id: name.replace(/\.jsonl$/, ""),
        mtimeMs: st.mtimeMs,
      });
    } catch {
      // file vanished between readdir and stat — ignore
    }
  }
  return out;
}

async function loadSessionExcerptsByDate(
  chatDir: string,
  sessionId: string,
): Promise<Map<string, SessionExcerpt>> {
  const jsonlPath = path.join(chatDir, `${sessionId}.jsonl`);
  const metaPath = path.join(chatDir, `${sessionId}.json`);

  const roleId = await readRoleId(metaPath);
  const raw = await fsp.readFile(jsonlPath, "utf-8");

  // One bucket per local-date this session touched.
  const buckets = new Map<string, SessionExcerpt>();

  // We don't have per-event timestamps in the legacy jsonl format,
  // so fall back to the file's mtime for unscoped events. If the
  // session spans midnight we still bucket everything into whichever
  // date the mtime lands in — acceptable for a personal workspace
  // where most sessions are short-lived.
  const fallbackDate = toIsoDate((await fsp.stat(jsonlPath)).mtimeMs);

  let count = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    if (count >= MAX_EVENTS_PER_SESSION) break;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "session_meta" || entry.type === "claude_session_id") {
      continue;
    }
    const parsed = parseEntry(entry);
    if (!parsed) continue;
    count++;

    const date = fallbackDate;
    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = { sessionId, roleId, events: [], artifactPaths: [] };
      buckets.set(date, bucket);
    }
    bucket.events.push(parsed.excerpt);
    for (const p of parsed.artifactPaths) {
      if (!bucket.artifactPaths.includes(p)) bucket.artifactPaths.push(p);
    }
  }
  return buckets;
}

async function readRoleId(metaPath: string): Promise<string> {
  try {
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    if (typeof meta.roleId === "string") return meta.roleId;
  } catch {
    // ignore
  }
  return "unknown";
}

// Convert one jsonl entry into a flat excerpt the archivist can read,
// plus any workspace-relative artifact paths the entry references.
// Exported so tests can exercise it with fabricated entries.
export interface ParsedEntry {
  excerpt: SessionEventExcerpt;
  // 0+ workspace-relative artifact paths referenced by this entry.
  // Used to build the ARTIFACTS REFERENCED prompt section.
  artifactPaths: string[];
}

export function parseEntry(entry: Record<string, unknown>): ParsedEntry | null {
  const excerpt = entryToExcerpt(entry);
  if (!excerpt) return null;
  return {
    excerpt,
    artifactPaths: extractArtifactPaths(entry),
  };
}

// Legacy single-purpose form used by the existing unit tests.
// Prefer `parseEntry` for code that also wants artifact paths.
export function entryToExcerpt(
  entry: Record<string, unknown>,
): SessionEventExcerpt | null {
  const source = typeof entry.source === "string" ? entry.source : "unknown";
  const type = typeof entry.type === "string" ? entry.type : "unknown";

  // text entries: {source, type: "text", message}
  if (type === "text" && typeof entry.message === "string") {
    return {
      source,
      type,
      content: truncate(entry.message, MAX_EVENT_CONTENT_CHARS),
    };
  }
  // tool_result entries: {source: "tool", type: "tool_result", result: {toolName, message, ...}}
  // `typeof null === "object"` so we must explicitly reject null
  // to avoid a NullPointerException-style crash when accessing
  // r.toolName below.
  if (
    type === "tool_result" &&
    typeof entry.result === "object" &&
    entry.result !== null
  ) {
    const r = entry.result as Record<string, unknown>;
    const toolName = typeof r.toolName === "string" ? r.toolName : "tool";
    const label =
      (typeof r.title === "string" && r.title) ||
      (typeof r.message === "string" && r.message) ||
      "(no message)";
    return {
      source,
      type,
      content: `${toolName}: ${truncate(String(label), MAX_EVENT_CONTENT_CHARS - toolName.length - 2)}`,
    };
  }
  return null;
}

// Pull workspace-relative artifact paths out of a jsonl entry. The
// extraction is tool-aware: different plugins stash file paths in
// different places inside their tool_result data. Exported for
// tests.
export function extractArtifactPaths(entry: Record<string, unknown>): string[] {
  if (entry.type !== "tool_result") return [];
  const result = entry.result;
  if (typeof result !== "object" || result === null) return [];
  const r = result as Record<string, unknown>;
  const data = r.data;
  if (typeof data !== "object" || data === null) return [];
  const d = data as Record<string, unknown>;
  const paths: string[] = [];

  // Direct `filePath: string` — presentMulmoScript, presentHtml.
  if (typeof d.filePath === "string" && d.filePath.length > 0) {
    paths.push(d.filePath);
  }

  // Wiki uses `pageName: string` and stores the page at
  // `wiki/pages/<pageName>.md`. The plugin itself doesn't surface
  // the full path in the result, so we synthesise it from the
  // convention established in server/routes/wiki.ts.
  if (r.toolName === "manageWiki" && typeof d.pageName === "string") {
    paths.push(`wiki/pages/${d.pageName}.md`);
  }

  // Paths must be workspace-relative (not absolute, no escape).
  // Drop anything suspicious rather than link to it.
  return paths.filter(isSafeWorkspacePath);
}

// Defensive: refuse absolute paths, parent-escapes, or scheme-like
// strings. Protects against a malformed tool result wedging a
// filesystem-absolute path into the archivist prompt.
function isSafeWorkspacePath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith("/")) return false;
  if (p.startsWith("..")) return false;
  if (p.includes("://")) return false;
  return true;
}

function truncate(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

async function readAllTopics(
  workspaceRoot: string,
): Promise<ExistingTopicSnapshot[]> {
  const dir = path.join(summariesRoot(workspaceRoot), TOPICS_DIR);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out: ExistingTopicSnapshot[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const slug = name.replace(/\.md$/, "");
    try {
      const content = await fsp.readFile(path.join(dir, name), "utf-8");
      out.push({ slug, content });
    } catch {
      // ignore
    }
  }
  return out;
}

async function readTextOrNull(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, "utf-8");
  } catch {
    return null;
  }
}

async function writeDailySummary(
  workspaceRoot: string,
  date: string,
  content: string,
): Promise<void> {
  const p = dailyPathFor(workspaceRoot, date);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, "utf-8");
}

async function applyTopicUpdate(
  workspaceRoot: string,
  update: TopicUpdate,
): Promise<"created" | "updated"> {
  const p = topicPathFor(workspaceRoot, update.slug);
  await fsp.mkdir(path.dirname(p), { recursive: true });

  if (update.action === "create") {
    // If the file already exists (e.g. the LLM mis-classified), treat
    // it as an append so we don't clobber prior content.
    const existing = await readTextOrNull(p);
    if (existing === null) {
      await fsp.writeFile(p, update.content, "utf-8");
      return "created";
    }
    await fsp.writeFile(
      p,
      `${existing.trimEnd()}\n\n${update.content}\n`,
      "utf-8",
    );
    return "updated";
  }
  if (update.action === "rewrite") {
    const existed = (await readTextOrNull(p)) !== null;
    await fsp.writeFile(p, update.content, "utf-8");
    return existed ? "updated" : "created";
  }
  // append
  const existing = await readTextOrNull(p);
  if (existing === null) {
    await fsp.writeFile(p, update.content, "utf-8");
    return "created";
  }
  await fsp.writeFile(
    p,
    `${existing.trimEnd()}\n\n${update.content}\n`,
    "utf-8",
  );
  return "updated";
}
