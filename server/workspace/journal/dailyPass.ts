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
import { writeDailySummary, readDailySummary, readTopicFile, writeTopicFile, appendOrCreateTopic, readAllTopicFiles } from "../../utils/files/journal-io.js";
import { readSessionMeta as readSessionMetaIO, readSessionJsonl as readSessionJsonlIO } from "../../utils/files/session-io.js";
import { statUnder } from "../../utils/files/workspace-io.js";
import {
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
} from "./archivist-schemas.js";
import { type Summarize, ClaudeCliNotFoundError } from "./archivist-cli.js";
import { toIsoDate, slugify } from "./paths.js";
import { findDirtySessions, applyProcessed, type SessionFileMeta } from "./diff.js";
import { rewriteWorkspaceLinks } from "../../utils/markdown.js";
import { writeState, type JournalState } from "./state.js";
import { log } from "../../system/logger/index.js";
import { EVENT_TYPES } from "../../../src/types/events.js";
import { extractAndAppendMemory } from "./memoryExtractor.js";
import { isRecord } from "../../utils/types.js";

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

// Inputs to the day loop, gathered up-front by `buildDailyPassPlan`
// so `runDailyPass` reads as orchestration only — no IO interleaved
// with scheduling decisions. Returned as a single object instead of
// a tuple so future fields (e.g. caller-provided clock for tests)
// can be added without re-threading every call site.
//
// `newTopicsSeen` is a mutable accumulator: the day loop adds to it
// as topics are created. Including it in the plan keeps the lifecycle
// visible at the call site.
export interface DailyPassPlan {
  workspaceRoot: string;
  perSessionExcerpts: Map<string, Map<string, SessionExcerpt>>;
  dayBuckets: ReadonlyMap<string, SessionExcerpt[]>;
  sessionToDays: Map<string, Set<string>>;
  /** Day keys in chronological order so an earlier day's topic
   *  updates are visible to the next day's processing. */
  orderedDays: string[];
  existingTopics: ExistingTopicSnapshot[];
  /** Mutable — the day loop adds new topic slugs as they're created. */
  newTopicsSeen: Set<string>;
  initialNextState: JournalState;
  dirtyMetaById: ReadonlyMap<string, SessionFileMeta>;
}

/**
 * Read-only setup for `runDailyPass`: enumerate sessions, find the
 * dirty ones, build day buckets, snapshot existing topics, and
 * compute the initial mutable state. Returns `null` when there's
 * nothing to do (no dirty sessions). Otherwise returns a plan object
 * the day loop can iterate over.
 *
 * Intentionally does NOT short-circuit on empty `dayBuckets`. If
 * every dirty session produces zero excerpts (all malformed, or all
 * tool-only with no text turns) we still want `readAllTopics` to
 * fire and `initialNextState.knownTopics` to be normalised/sorted.
 * The day loop then iterates zero times and we drop straight through.
 */
export async function buildDailyPassPlan(state: JournalState, deps: DailyPassDeps): Promise<DailyPassPlan | null> {
  const workspaceRoot = deps.workspaceRoot ?? defaultWorkspacePath;
  const chatDir = path.join(workspaceRoot, WORKSPACE_DIRS.chat);

  const eligible = (await listSessionMetas(chatDir)).filter((sessionMeta) => !deps.activeSessionIds.has(sessionMeta.id));
  const { dirty } = findDirtySessions(eligible, state.processedSessions);
  if (dirty.length === 0) return null;

  const perSessionExcerpts = await loadDirtySessionExcerpts(chatDir, dirty, workspaceRoot);
  const { dayBuckets, sessionToDays } = buildDayBuckets(perSessionExcerpts);

  const existingTopics = await readAllTopics(workspaceRoot);
  const newTopicsSeen = new Set<string>(state.knownTopics);
  // `nextState` is rebuilt through the day loop and persisted after
  // each successful day via writeState (atomic tmp+rename). We do
  // NOT bump lastDailyRunAt here — that's the outer runner's job
  // after the whole pass (including optimization) finishes, so
  // partial progress doesn't look like a complete pass.
  const initialNextState: JournalState = {
    ...state,
    knownTopics: [...newTopicsSeen].sort(),
  };
  const dirtyMetaById = new Map(eligible.map((sessionMeta) => [sessionMeta.id, sessionMeta]));
  const orderedDays = [...dayBuckets.keys()].sort();

  return {
    workspaceRoot,
    perSessionExcerpts,
    dayBuckets,
    sessionToDays,
    orderedDays,
    existingTopics,
    newTopicsSeen,
    initialNextState,
    dirtyMetaById,
  };
}

export async function runDailyPass(state: JournalState, deps: DailyPassDeps): Promise<{ nextState: JournalState; result: DailyPassResult }> {
  const result: DailyPassResult = {
    daysTouched: [],
    sessionsIngested: [],
    topicsCreated: [],
    topicsUpdated: [],
    skipped: [],
  };

  const plan = await buildDailyPassPlan(state, deps);
  if (plan === null) return { nextState: { ...state }, result };

  let nextState = plan.initialNextState;

  for (const date of plan.orderedDays) {
    const dayResult = await processDayAndAdvance({
      workspaceRoot: plan.workspaceRoot,
      date,
      dayBuckets: plan.dayBuckets,
      existingTopics: plan.existingTopics,
      summarize: deps.summarize,
      sessionToDays: plan.sessionToDays,
      dirtyMetaById: plan.dirtyMetaById,
      newTopicsSeen: plan.newTopicsSeen,
      nextState,
    });
    if (dayResult.kind === "skipped") {
      result.skipped.push({ date, reason: dayResult.reason });
    } else {
      result.daysTouched.push(date);
      result.topicsCreated.push(...dayResult.topicsCreated);
      result.topicsUpdated.push(...dayResult.topicsUpdated);
      result.sessionsIngested.push(...dayResult.sessionsIngested);
    }
    nextState = dayResult.nextState;
  }

  await maybeExtractMemory(plan.perSessionExcerpts, plan.workspaceRoot, deps);

  return { nextState, result };
}

// --- Phase 3 helper: single-day processing + state advance -----------
// Extracted from the Phase 3 for-loop to keep runDailyPass under
// the sonarjs/cognitive-complexity threshold.

interface ProcessDayInput {
  workspaceRoot: string;
  date: string;
  dayBuckets: ReadonlyMap<string, SessionExcerpt[]>;
  existingTopics: ExistingTopicSnapshot[];
  summarize: Summarize;
  sessionToDays: Map<string, Set<string>>;
  dirtyMetaById: ReadonlyMap<string, SessionFileMeta>;
  newTopicsSeen: Set<string>;
  nextState: JournalState;
}

type ProcessDayOutput =
  | {
      kind: "skipped";
      reason: string;
      nextState: JournalState;
    }
  | {
      kind: "processed";
      topicsCreated: string[];
      topicsUpdated: string[];
      sessionsIngested: string[];
      nextState: JournalState;
    };

async function processDayAndAdvance(input: ProcessDayInput): Promise<ProcessDayOutput> {
  const excerpts = input.dayBuckets.get(input.date) ?? [];
  const dayOutcome = await processOneDay(input.workspaceRoot, input.date, excerpts, input.existingTopics, input.summarize);
  if (dayOutcome.kind === "skipped") {
    return {
      kind: "skipped",
      reason: dayOutcome.reason,
      nextState: input.nextState,
    };
  }

  for (const slug of dayOutcome.topicsTouched) {
    input.newTopicsSeen.add(slug);
  }

  const justCompleted = computeJustCompletedSessions(input.date, excerpts, input.sessionToDays, input.dirtyMetaById);
  const sessionsIngested = justCompleted.map((sessionMeta) => sessionMeta.id);
  const nextState = advanceJournalState(input.nextState, justCompleted, input.newTopicsSeen);
  await persistStateAfterDay(input.workspaceRoot, nextState, input.date);

  return {
    kind: "processed",
    topicsCreated: dayOutcome.topicsCreated,
    topicsUpdated: dayOutcome.topicsUpdated,
    sessionsIngested,
    nextState,
  };
}

// --- Phase 4 helper: memory extraction -------------------------------
// Scan dirty-session excerpts for durable user facts and append new
// ones to memory.md. Fire-and-forget: if extraction fails the daily
// summaries are already written, so the pass is still useful.

async function maybeExtractMemory(
  perSessionExcerpts: ReadonlyMap<string, ReadonlyMap<string, SessionExcerpt>>,
  workspaceRoot: string,
  deps: DailyPassDeps,
): Promise<void> {
  if (perSessionExcerpts.size === 0) return;
  const excerptLines: string[] = [];
  for (const [, byDate] of perSessionExcerpts) {
    for (const [, excerpt] of byDate) {
      const userLines = excerpt.events
        .filter((eventExcerpt: SessionEventExcerpt) => eventExcerpt.source === "user")
        .map((eventExcerpt: SessionEventExcerpt) => `[user] ${eventExcerpt.content}`);
      if (userLines.length > 0) excerptLines.push(userLines.join("\n"));
    }
  }
  try {
    await extractAndAppendMemory({
      workspaceRoot,
      excerpts: excerptLines.join("\n---\n"),
      summarize: deps.summarize,
    });
  } catch (err) {
    log.warn("daily-pass", "memory extraction failed (non-fatal)", {
      error: String(err),
    });
  }
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
  const existingDaily = await readDailySummary(date, workspaceRoot);
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

  await writeDailySummaryForDate(workspaceRoot, date, parsed.dailySummaryMarkdown);

  const topicOutcome = await processTopicUpdatesForDay(workspaceRoot, parsed.topicUpdates, existingTopics);

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
async function callSummarizeForDay(date: string, input: DailyArchivistInput, summarize: Summarize): Promise<string | null> {
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
async function writeDailySummaryForDate(workspaceRoot: string, date: string, rawMarkdown: string): Promise<void> {
  // Rewrite any /workspace-absolute links in the archivist's output
  // into true-relative links from the daily summary's location
  // before writing to disk. Same treatment below for topic files.
  const [yearPart, monthPart, dayPart] = date.split("-");
  const dailyFileWsPath = path.posix.join(WORKSPACE_DIRS.summaries, "daily", yearPart, monthPart, `${dayPart}.md`);
  const content = rewriteWorkspaceLinks(dailyFileWsPath, rawMarkdown);
  await writeDailySummary(date, content, workspaceRoot);
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
      await refreshTopicSnapshot(workspaceRoot, normalized.slug, existingTopics);
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
async function refreshTopicSnapshot(workspaceRoot: string, slug: string, existingTopics: ExistingTopicSnapshot[]): Promise<void> {
  const newBody = await readTopicFile(slug, workspaceRoot);
  if (newBody === null) return;
  const snapshot: ExistingTopicSnapshot = { slug, content: newBody };
  const idx = existingTopics.findIndex((topic) => topic.slug === slug);
  if (idx === -1) existingTopics.push(snapshot);
  else existingTopics[idx] = snapshot;
}

// Persist the in-progress journal state after each day so a
// mid-pass crash only costs the work written after the last
// checkpoint. Write failures are logged but don't fail the pass —
// the day's markdown is already on disk and the next run will
// catch up.
async function persistStateAfterDay(workspaceRoot: string, state: JournalState, date: string): Promise<void> {
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

export function buildDayBuckets(perSessionExcerpts: ReadonlyMap<string, ReadonlyMap<string, SessionExcerpt>>): DayBucketsPlan {
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
export function normalizeTopicAction(update: TopicUpdate, existingTopics: readonly ExistingTopicSnapshot[]): TopicUpdate {
  const canonicalSlug = slugify(update.slug);
  const exists = existingTopics.some((topic) => topic.slug === canonicalSlug);
  const topicFileWsPath = path.posix.join(WORKSPACE_DIRS.summaries, "topics", `${canonicalSlug}.md`);
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
export function parseArchivistOutput(rawOutput: string): DailyArchivistOutput | null {
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
export function advanceJournalState(prev: JournalState, justCompleted: readonly SessionFileMeta[], newTopicsSeen: ReadonlySet<string>): JournalState {
  return {
    ...prev,
    processedSessions: applyProcessed(prev.processedSessions, [...justCompleted]),
    knownTopics: [...newTopicsSeen].sort(),
  };
}

// --- Filesystem helpers ---------------------------------------------

// Load every dirty session's jsonl, bucket events by local-date,
// and return the whole collection as a Map<sessionId, Map<date,
// excerpt>>. Malformed sessions are logged and skipped so one
// bad jsonl can't crash the pass. Returned shape is exactly what
// `buildDayBuckets` wants as input.
async function loadDirtySessionExcerpts(chatDir: string, dirty: readonly string[], workspaceRoot: string): Promise<Map<string, Map<string, SessionExcerpt>>> {
  const perSession = new Map<string, Map<string, SessionExcerpt>>();
  for (const sessionId of dirty) {
    try {
      const excerpts = await loadSessionExcerptsByDate(chatDir, sessionId, workspaceRoot);
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
      const stats = await fsp.stat(full);
      out.push({
        id: name.replace(/\.jsonl$/, ""),
        mtimeMs: stats.mtimeMs,
      });
    } catch {
      // file vanished between readdir and stat — ignore
    }
  }
  return out;
}

async function loadSessionExcerptsByDate(chatDir: string, sessionId: string, workspaceRoot: string): Promise<Map<string, SessionExcerpt>> {
  const roleId = await readRoleIdFromMeta(sessionId, workspaceRoot);
  const raw = await readSessionJsonlIO(sessionId, workspaceRoot);
  if (!raw) return new Map();

  const stat = await statUnder(workspaceRoot, path.posix.join(WORKSPACE_DIRS.chat, `${sessionId}.jsonl`));
  const fallbackDate = toIsoDate(stat?.mtimeMs ?? Date.now());

  const parsedEvents = parseJsonlEvents(raw, MAX_EVENTS_PER_SESSION);
  return bucketParsedEvents(parsedEvents, sessionId, roleId, fallbackDate);
}

// Walk a jsonl string and return at most `maxEvents` parsed events
// ready for bucketing. Skips blank lines, malformed JSON,
// metadata entries, and anything `parseEntry` rejects. Pure —
// exported so tests can exercise it with fabricated jsonl strings.
export function parseJsonlEvents(raw: string, maxEvents: number): ParsedEntry[] {
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
  if (!isRecord(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

function isMetadataEntry(entry: Record<string, unknown>): boolean {
  return entry.type === EVENT_TYPES.sessionMeta || entry.type === EVENT_TYPES.claudeSessionId;
}

// Collect parsed events into per-date buckets using `fallbackDate`
// for every event, since the legacy jsonl format has no per-event
// timestamps. Extracted so the I/O-free bucket-building can be
// reasoned about and unit-tested without a real jsonl file.
export function bucketParsedEvents(events: readonly ParsedEntry[], sessionId: string, roleId: string, fallbackDate: string): Map<string, SessionExcerpt> {
  const buckets = new Map<string, SessionExcerpt>();
  for (const parsed of events) {
    let bucket = buckets.get(fallbackDate);
    if (!bucket) {
      bucket = { sessionId, roleId, events: [], artifactPaths: [] };
      buckets.set(fallbackDate, bucket);
    }
    bucket.events.push(parsed.excerpt);
    for (const artifactPath of parsed.artifactPaths) {
      if (!bucket.artifactPaths.includes(artifactPath)) bucket.artifactPaths.push(artifactPath);
    }
  }
  return buckets;
}

async function readRoleIdFromMeta(sessionId: string, workspaceRoot: string): Promise<string> {
  try {
    const meta = await readSessionMetaIO(sessionId, workspaceRoot);
    if (meta && typeof meta.roleId === "string") return meta.roleId;
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
export function entryToExcerpt(entry: Record<string, unknown>): SessionEventExcerpt | null {
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
  if (type === EVENT_TYPES.toolResult && isRecord(entry.result)) {
    const resultRecord = entry.result as Record<string, unknown>;
    const toolName = typeof resultRecord.toolName === "string" ? resultRecord.toolName : "tool";
    const label =
      (typeof resultRecord.title === "string" && resultRecord.title) || (typeof resultRecord.message === "string" && resultRecord.message) || "(no message)";
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
  if (!isRecord(result)) return [];
  const resultRecord = result as Record<string, unknown>;
  const data = resultRecord.data;
  if (!isRecord(data)) return [];
  const dataRecord = data as Record<string, unknown>;
  const paths: string[] = [];

  // Direct `filePath: string` — presentMulmoScript, presentHtml.
  if (typeof dataRecord.filePath === "string" && dataRecord.filePath.length > 0) {
    paths.push(dataRecord.filePath);
  }

  // Wiki uses `pageName: string` and stores the page at
  // `wiki/pages/<pageName>.md`. The plugin itself doesn't surface
  // the full path in the result, so we synthesise it from the
  // convention established in server/routes/wiki.ts.
  if (resultRecord.toolName === "manageWiki" && typeof dataRecord.pageName === "string") {
    paths.push(`wiki/pages/${dataRecord.pageName}.md`);
  }

  // Paths must be workspace-relative (not absolute, no escape).
  // Drop anything suspicious rather than link to it.
  return paths.filter(isSafeWorkspacePath);
}

// Defensive: refuse absolute paths, parent-escapes, or scheme-like
// strings. Protects against a malformed tool result wedging a
// filesystem-absolute path into the archivist prompt.
function isSafeWorkspacePath(candidatePath: string): boolean {
  if (!candidatePath) return false;
  if (candidatePath.startsWith("/")) return false;
  if (candidatePath.startsWith("..")) return false;
  if (candidatePath.includes("://")) return false;
  return true;
}

function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

async function readAllTopics(workspaceRoot: string): Promise<ExistingTopicSnapshot[]> {
  const topicMap = await readAllTopicFiles(workspaceRoot);
  const out: ExistingTopicSnapshot[] = [];
  for (const [slug, content] of topicMap) {
    out.push({ slug, content });
  }
  return out;
}

async function applyTopicUpdate(workspaceRoot: string, update: TopicUpdate): Promise<"created" | "updated"> {
  if (update.action === "create" || update.action === "append") {
    return appendOrCreateTopic(update.slug, update.content, workspaceRoot);
  }
  // rewrite
  const existed = (await readTopicFile(update.slug, workspaceRoot)) !== null;
  await writeTopicFile(update.slug, update.content, workspaceRoot);
  return existed ? "updated" : "created";
}
