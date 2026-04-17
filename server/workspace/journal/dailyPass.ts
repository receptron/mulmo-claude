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
import { WORKSPACE_DIRS } from "../paths.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import {
  type Summarize,
  type SessionExcerpt,
  type SessionEventExcerpt,
  type ExistingTopicSnapshot,
  type DailyArchivistInput,
  type DailyArchivistOutput,
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
import { readTextOrNull } from "../../utils/fs.js";
import { log } from "../../system/logger/index.js";
import { EVENT_TYPES } from "../../../src/types/events.js";

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
  const chatDir = path.join(workspaceRoot, WORKSPACE_DIRS.chat);
  const result: DailyPassResult = {
    daysTouched: [],
    sessionsIngested: [],
    topicsCreated: [],
    topicsUpdated: [],
    skipped: [],
  };

  // --- Phase 1: figure out what work there is to do ------------------
  const eligible = (await listSessionMetas(chatDir)).filter(
    (m) => !deps.activeSessionIds.has(m.id),
  );
  const { dirty } = findDirtySessions(eligible, state.processedSessions);
  if (dirty.length === 0) return { nextState: { ...state }, result };

  const perSessionExcerpts = await loadDirtySessionExcerpts(chatDir, dirty);
  const { dayBuckets, sessionToDays } = buildDayBuckets(perSessionExcerpts);

  // Note: we intentionally do NOT early-return when `dayBuckets` is
  // empty. Letting the pipeline fall through preserves the pre-
  // refactor behaviour for the edge case where every dirty session
  // produces zero excerpts (all malformed, or all metadata/tool-only
  // with no text turns): `readAllTopics` still fires, and the
  // returned `nextState.knownTopics` is still normalized / sorted
  // from the existing state. The empty `orderedDays` loop then
  // iterates zero times and we fall through to `return { nextState,
  // result }`.

  // --- Phase 2: set up per-pass state --------------------------------
  const existingTopics = await readAllTopics(workspaceRoot);
  const newTopicsSeen = new Set<string>(state.knownTopics);
  // `nextState` is rebuilt through the day loop and persisted after
  // each successful day via writeState (atomic tmp+rename). We do
  // NOT bump lastDailyRunAt here — that's the outer runner's job
  // after the whole pass (including optimization) finishes, so
  // partial progress doesn't look like a complete pass.
  let nextState: JournalState = {
    ...state,
    knownTopics: [...newTopicsSeen].sort(),
  };
  const dirtyMetaById = new Map(eligible.map((m) => [m.id, m]));
  // Process days in chronological order so topic state accumulates
  // naturally: an earlier day's update is visible to the next day.
  const orderedDays = [...dayBuckets.keys()].sort();

  // --- Phase 3: process each day -------------------------------------
  for (const date of orderedDays) {
    const excerpts = dayBuckets.get(date) ?? [];
    const dayOutcome = await processOneDay(
      workspaceRoot,
      date,
      excerpts,
      existingTopics,
      deps.summarize,
    );
    if (dayOutcome.kind === "skipped") {
      result.skipped.push({ date, reason: dayOutcome.reason });
      continue;
    }

    result.daysTouched.push(date);
    result.topicsCreated.push(...dayOutcome.topicsCreated);
    result.topicsUpdated.push(...dayOutcome.topicsUpdated);
    for (const slug of dayOutcome.topicsTouched) newTopicsSeen.add(slug);

    const justCompleted = computeJustCompletedSessions(
      date,
      excerpts,
      sessionToDays,
      dirtyMetaById,
    );
    if (justCompleted.length > 0) {
      result.sessionsIngested.push(...justCompleted.map((m) => m.id));
    }
    nextState = advanceJournalState(nextState, justCompleted, newTopicsSeen);

    await persistStateAfterDay(workspaceRoot, nextState, date);
  }

  return { nextState, result };
}

// --- Phase 3 helper: per-day side-effecting pipeline ----------------

// Discriminated return so `runDailyPass` can branch on outcome
// without digging into null or throwing.
export type DayOutcome =
  | { kind: "skipped"; reason: string }
  | {
      kind: "processed";
      topicsCreated: string[];
      topicsUpdated: string[];
      // Union of created + updated — handed back so the caller
      // can keep `newTopicsSeen` in sync without recomputing.
      topicsTouched: string[];
    };

// Run the archivist for one day and apply its output (daily
// summary + topic updates). All filesystem writes land here so
// `runDailyPass` stays branching-lean.
async function processOneDay(
  workspaceRoot: string,
  date: string,
  excerpts: SessionExcerpt[],
  existingTopics: ExistingTopicSnapshot[],
  summarize: Summarize,
): Promise<DayOutcome> {
  const existingDaily = await readTextOrNull(dailyPathFor(workspaceRoot, date));
  const input: DailyArchivistInput = {
    date,
    existingDailySummary: existingDaily,
    existingTopicSummaries: existingTopics,
    sessionExcerpts: excerpts,
  };

  const rawOutput = await callSummarizeForDay(date, input, summarize);
  if (rawOutput === null) {
    return { kind: "skipped", reason: "summarize failed" };
  }

  const parsed = parseArchivistOutput(rawOutput);
  if (parsed === null) {
    log.warn("journal", "archivist returned unusable JSON, skipping", {
      date,
    });
    return { kind: "skipped", reason: "unusable archivist JSON" };
  }

  await writeDailySummaryForDate(
    workspaceRoot,
    date,
    parsed.dailySummaryMarkdown,
  );

  const topicOutcome = await processTopicUpdatesForDay(
    workspaceRoot,
    parsed.topicUpdates,
    existingTopics,
  );

  return {
    kind: "processed",
    topicsCreated: topicOutcome.created,
    topicsUpdated: topicOutcome.updated,
    topicsTouched: [...topicOutcome.created, ...topicOutcome.updated],
  };
}

// Call the archivist summarizer and narrow its failure modes.
// Returns null on recoverable failures (logged + skipped), throws
// only for `ClaudeCliNotFoundError` which the outer runner uses to
// disable the whole journal feature for the process lifetime.
async function callSummarizeForDay(
  date: string,
  input: DailyArchivistInput,
  summarize: Summarize,
): Promise<string | null> {
  try {
    return await summarize(DAILY_SYSTEM_PROMPT, buildDailyUserPrompt(input));
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) throw err;
    log.warn("journal", "summarize failed, skipping day", {
      date,
      error: String(err),
    });
    return null;
  }
}

// Side-effecting wrapper: rewrite workspace-absolute links in the
// archivist output relative to the daily summary's own location,
// then write the file to disk. Factored out so the main loop's
// body no longer contains path-math and I/O intermixed.
async function writeDailySummaryForDate(
  workspaceRoot: string,
  date: string,
  rawMarkdown: string,
): Promise<void> {
  // Rewrite any /workspace-absolute links in the archivist's output
  // into true-relative links from the daily summary's location
  // before writing to disk. Same treatment below for topic files.
  const [yearPart, monthPart, dayPart] = date.split("-");
  const dailyFileWsPath = path.posix.join(
    WORKSPACE_DIRS.summaries,
    "daily",
    yearPart,
    monthPart,
    `${dayPart}.md`,
  );
  const content = rewriteWorkspaceLinks(dailyFileWsPath, rawMarkdown);
  await writeDailySummary(workspaceRoot, date, content);
}

// Apply every topic update the archivist asked for, keeping the
// in-memory `existingTopics` snapshot in sync so the next day in
// this same pass sees fresh content. Mutates `existingTopics`.
//
// Per-update failures (EACCES, EIO, etc. surfaced by appendOrCreate)
// are logged and skipped so a single broken topic file doesn't kill
// the whole pass after days of progress have already been committed.
async function processTopicUpdatesForDay(
  workspaceRoot: string,
  updates: readonly TopicUpdate[],
  existingTopics: ExistingTopicSnapshot[],
): Promise<{ created: string[]; updated: string[] }> {
  const created: string[] = [];
  const updated: string[] = [];
  for (const update of updates) {
    const normalized = normalizeTopicAction(update, existingTopics);
    try {
      const outcome = await applyTopicUpdate(workspaceRoot, normalized);
      if (outcome === "created") created.push(normalized.slug);
      else if (outcome === "updated") updated.push(normalized.slug);
      await refreshTopicSnapshot(
        workspaceRoot,
        normalized.slug,
        existingTopics,
      );
    } catch (err) {
      log.warn("journal", "failed to apply topic update", {
        slug: normalized.slug,
        error: String(err),
      });
    }
  }
  return { created, updated };
}

// Re-read the topic file fresh and upsert its snapshot into the
// in-memory `existingTopics` list so the next day's archivist
// call sees the latest content.
async function refreshTopicSnapshot(
  workspaceRoot: string,
  slug: string,
  existingTopics: ExistingTopicSnapshot[],
): Promise<void> {
  const newBody = await readTextOrNull(topicPathFor(workspaceRoot, slug));
  if (newBody === null) return;
  const snapshot: ExistingTopicSnapshot = { slug, content: newBody };
  const idx = existingTopics.findIndex((t) => t.slug === slug);
  if (idx === -1) existingTopics.push(snapshot);
  else existingTopics[idx] = snapshot;
}

// Persist the in-progress journal state after each day so a
// mid-pass crash only costs the work written after the last
// checkpoint. Write failures are logged but don't fail the pass —
// the day's markdown is already on disk and the next run will
// catch up.
async function persistStateAfterDay(
  workspaceRoot: string,
  state: JournalState,
  date: string,
): Promise<void> {
  try {
    await writeState(workspaceRoot, state);
  } catch (err) {
    log.warn("journal", "failed to persist state after day", {
      date,
      error: String(err),
    });
  }
}

// --- Pure helpers (exported for unit tests) ------------------------

// Bucket every session's per-date excerpts into a `dayBuckets`
// map and a `sessionToDays` tracking map in one pass. Inputs are
// the per-session excerpts loaded by `loadDirtySessionExcerpts`;
// outputs are plain Maps the day loop can consume directly.
//
// `sessionToDays` is used later by `computeJustCompletedSessions`
// to mark a session fully processed only after its last day has
// been written. That's why both Maps are built here together —
// they're two views of the same input and staying in sync matters.
export interface DayBucketsPlan {
  dayBuckets: Map<string, SessionExcerpt[]>;
  sessionToDays: Map<string, Set<string>>;
}

export function buildDayBuckets(
  perSessionExcerpts: ReadonlyMap<string, ReadonlyMap<string, SessionExcerpt>>,
): DayBucketsPlan {
  const dayBuckets = new Map<string, SessionExcerpt[]>();
  const sessionToDays = new Map<string, Set<string>>();
  for (const [sessionId, byDate] of perSessionExcerpts) {
    for (const [date, excerpt] of byDate) {
      const bucket = dayBuckets.get(date);
      if (bucket) bucket.push(excerpt);
      else dayBuckets.set(date, [excerpt]);

      let days = sessionToDays.get(sessionId);
      if (!days) {
        days = new Set<string>();
        sessionToDays.set(sessionId, days);
      }
      days.add(date);
    }
  }
  return { dayBuckets, sessionToDays };
}

// Apply the append-to-missing → create guard and canonicalise
// the slug. The archivist occasionally asks to "append" to a
// brand-new topic; silently promoting that to "create" removes a
// whole class of LLM mistakes without needing a schema rejection.
// Also rewrites any workspace-absolute links in the body relative
// to the target topic file's location.
export function normalizeTopicAction(
  update: TopicUpdate,
  existingTopics: readonly ExistingTopicSnapshot[],
): TopicUpdate {
  const canonicalSlug = slugify(update.slug);
  const exists = existingTopics.some((t) => t.slug === canonicalSlug);
  const topicFileWsPath = path.posix.join(
    WORKSPACE_DIRS.summaries,
    "topics",
    `${canonicalSlug}.md`,
  );
  return {
    slug: canonicalSlug,
    action: !exists && update.action === "append" ? "create" : update.action,
    content: rewriteWorkspaceLinks(topicFileWsPath, update.content),
  };
}

// Parse an archivist raw output string into a validated
// DailyArchivistOutput. Returns null when the JSON envelope is
// missing or the shape doesn't match, so callers can treat it
// as a skip reason without needing a separate `isValid` check.
// Pure — combines `extractJsonObject` + `isDailyArchivistOutput`
// behind a single gate.
export function parseArchivistOutput(
  rawOutput: string,
): DailyArchivistOutput | null {
  const parsed = extractJsonObject(rawOutput);
  if (!isDailyArchivistOutput(parsed)) return null;
  return parsed;
}

// Decide which sessions have just completed their last pending
// day, mutating `sessionToDays` to drop `date` from every entry
// that touches it. Returns the `SessionFileMeta` records for the
// freshly-completed sessions so the caller can feed them into
// `applyProcessed`.
//
// A session is "complete" when its pending-days set, *after*
// removing the current date, is empty. Sessions not in
// `sessionToDays` (or not in `dirtyMetaById`) are silently
// skipped — defensive against unexpected inputs, and the same
// shape as the pre-refactor inline code.
export function computeJustCompletedSessions(
  date: string,
  excerpts: readonly SessionExcerpt[],
  sessionToDays: Map<string, Set<string>>,
  dirtyMetaById: ReadonlyMap<string, SessionFileMeta>,
): SessionFileMeta[] {
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
  return justCompleted;
}

// Build the next JournalState from the previous one plus a batch
// of just-completed sessions and the current view of known
// topics. Tiny pure wrapper so the day loop has one place to
// advance state instead of five-line spread literals scattered
// through it.
export function advanceJournalState(
  prev: JournalState,
  justCompleted: readonly SessionFileMeta[],
  newTopicsSeen: ReadonlySet<string>,
): JournalState {
  return {
    ...prev,
    processedSessions: applyProcessed(prev.processedSessions, [
      ...justCompleted,
    ]),
    knownTopics: [...newTopicsSeen].sort(),
  };
}

// --- Filesystem helpers ---------------------------------------------

// Load every dirty session's jsonl, bucket events by local-date,
// and return the whole collection as a Map<sessionId, Map<date,
// excerpt>>. Malformed sessions are logged and skipped so one
// bad jsonl can't crash the pass. Returned shape is exactly what
// `buildDayBuckets` wants as input.
async function loadDirtySessionExcerpts(
  chatDir: string,
  dirty: readonly string[],
): Promise<Map<string, Map<string, SessionExcerpt>>> {
  const perSession = new Map<string, Map<string, SessionExcerpt>>();
  for (const sessionId of dirty) {
    try {
      const excerpts = await loadSessionExcerptsByDate(chatDir, sessionId);
      if (excerpts.size > 0) perSession.set(sessionId, excerpts);
    } catch (err) {
      log.warn("journal", "failed to load session", {
        sessionId,
        error: String(err),
      });
    }
  }
  return perSession;
}

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

  // We don't have per-event timestamps in the legacy jsonl format,
  // so fall back to the file's mtime for unscoped events. If the
  // session spans midnight we still bucket everything into whichever
  // date the mtime lands in — acceptable for a personal workspace
  // where most sessions are short-lived.
  const fallbackDate = toIsoDate((await fsp.stat(jsonlPath)).mtimeMs);

  const parsedEvents = parseJsonlEvents(raw, MAX_EVENTS_PER_SESSION);
  return bucketParsedEvents(parsedEvents, sessionId, roleId, fallbackDate);
}

// Walk a jsonl string and return at most `maxEvents` parsed events
// ready for bucketing. Skips blank lines, malformed JSON,
// metadata entries, and anything `parseEntry` rejects. Pure —
// exported so tests can exercise it with fabricated jsonl strings.
export function parseJsonlEvents(
  raw: string,
  maxEvents: number,
): ParsedEntry[] {
  const events: ParsedEntry[] = [];
  for (const line of raw.split("\n")) {
    if (events.length >= maxEvents) break;
    const entry = parseJsonlLine(line);
    if (entry === null) continue;
    if (isMetadataEntry(entry)) continue;
    const parsed = parseEntry(entry);
    if (parsed) events.push(parsed);
  }
  return events;
}

// JSON.parse one jsonl line, guarding against blank lines,
// malformed JSON, and any JSON value that isn't a plain object.
// `JSON.parse` will happily return `null`, arrays, strings,
// numbers, or booleans, none of which the downstream
// `parseEntry` / `entryToExcerpt` functions can consume — and
// `entry.type` on a `null` or primitive throws at runtime.
// Returning `null` here collapses every invalid shape into the
// same "skip this line" sentinel the caller already handles.
function parseJsonlLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function isMetadataEntry(entry: Record<string, unknown>): boolean {
  return (
    entry.type === EVENT_TYPES.sessionMeta ||
    entry.type === EVENT_TYPES.claudeSessionId
  );
}

// Collect parsed events into per-date buckets using `fallbackDate`
// for every event, since the legacy jsonl format has no per-event
// timestamps. Extracted so the I/O-free bucket-building can be
// reasoned about and unit-tested without a real jsonl file.
export function bucketParsedEvents(
  events: readonly ParsedEntry[],
  sessionId: string,
  roleId: string,
  fallbackDate: string,
): Map<string, SessionExcerpt> {
  const buckets = new Map<string, SessionExcerpt>();
  for (const parsed of events) {
    let bucket = buckets.get(fallbackDate);
    if (!bucket) {
      bucket = { sessionId, roleId, events: [], artifactPaths: [] };
      buckets.set(fallbackDate, bucket);
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
  if (type === EVENT_TYPES.text && typeof entry.message === "string") {
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
    type === EVENT_TYPES.toolResult &&
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

async function writeDailySummary(
  workspaceRoot: string,
  date: string,
  content: string,
): Promise<void> {
  const p = dailyPathFor(workspaceRoot, date);
  await writeFileAtomic(p, content);
}

// If the file doesn't exist, write `content` fresh; otherwise append
// it after a blank line. Returns "created" or "updated" so the caller
// can report which action was taken.
//
// Distinguishes a true missing file (ENOENT) from other read errors
// (permission denied, I/O failure) — without this, a transient EACCES
// on an existing topic would silently overwrite it.
//
// Exported for unit testing in test/journal/test_appendOrCreate.ts.
export async function appendOrCreate(
  filePath: string,
  content: string,
): Promise<"created" | "updated"> {
  let existing: string;
  try {
    existing = await fsp.readFile(filePath, "utf-8");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      await writeFileAtomic(filePath, content);
      return "created";
    }
    throw err;
  }
  await writeFileAtomic(filePath, `${existing.trimEnd()}\n\n${content}\n`);
  return "updated";
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
    return appendOrCreate(p, update.content);
  }
  if (update.action === "rewrite") {
    const existed = (await readTextOrNull(p)) !== null;
    await writeFileAtomic(p, update.content);
    return existed ? "updated" : "created";
  }
  // append
  return appendOrCreate(p, update.content);
}
