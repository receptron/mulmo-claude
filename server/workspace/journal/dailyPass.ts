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

// Truncate per-event content so an oversized tool result (e.g. base64 image) doesn't blow past the CLI's context window.
const MAX_EVENT_CONTENT_CHARS = 600;

// Cap events per session in the prompt; sessions with thousands keep the head — archivist gets the gist from the opening.
const MAX_EVENTS_PER_SESSION = 80;

export interface DailyPassDeps {
  workspaceRoot?: string;
  summarize: Summarize;
  // Skip mid-write sessions: caller passes the live registry so we don't ingest jsonl the agent is still appending to.
  activeSessionIds: ReadonlySet<string>;
}

export interface DailyPassResult {
  daysTouched: string[]; // YYYY-MM-DD values actually written
  sessionsIngested: string[];
  topicsCreated: string[];
  topicsUpdated: string[];
  skipped: Array<{ date: string; reason: string }>;
}

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

// Do NOT short-circuit on empty dayBuckets: if every dirty session yields zero excerpts we still want readAllTopics to
// fire so initialNextState.knownTopics is normalised/sorted; the day loop then iterates zero times and drops through.
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
  // Do NOT bump lastDailyRunAt here — outer runner does it after optimization, so partial progress isn't a complete pass.
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

// Fire-and-forget: if memory extraction fails the daily summaries are already written, so the pass is still useful.
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

export type DayOutcome =
  | { kind: "skipped"; reason: string }
  | {
      kind: "processed";
      topicsCreated: string[];
      topicsUpdated: string[];
      // Union of created + updated so the caller can keep newTopicsSeen in sync without recomputing.
      topicsTouched: string[];
    };

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

// Throws only for ClaudeCliNotFoundError (outer runner uses it to disable the whole journal feature for the process lifetime).
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

async function writeDailySummaryForDate(workspaceRoot: string, date: string, rawMarkdown: string): Promise<void> {
  // Rewrite /workspace-absolute links into true-relative links from the daily summary's location (same for topic files).
  const [yearPart, monthPart, dayPart] = date.split("-");
  const dailyFileWsPath = path.posix.join(WORKSPACE_DIRS.summaries, "daily", yearPart, monthPart, `${dayPart}.md`);
  const content = rewriteWorkspaceLinks(dailyFileWsPath, rawMarkdown);
  await writeDailySummary(date, content, workspaceRoot);
}

// Mutates existingTopics so the next day in the same pass sees fresh content. Per-update failures are logged + skipped
// so one broken topic file doesn't kill the whole pass after days of progress have already been committed.
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

async function refreshTopicSnapshot(workspaceRoot: string, slug: string, existingTopics: ExistingTopicSnapshot[]): Promise<void> {
  const newBody = await readTopicFile(slug, workspaceRoot);
  if (newBody === null) return;
  const snapshot: ExistingTopicSnapshot = { slug, content: newBody };
  const idx = existingTopics.findIndex((topic) => topic.slug === slug);
  if (idx === -1) existingTopics.push(snapshot);
  else existingTopics[idx] = snapshot;
}

// Checkpoint state after each day so a mid-pass crash only costs work since the last write. Write failures don't fail
// the pass — the day's markdown is already on disk and the next run catches up.
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

// dayBuckets and sessionToDays must stay in sync — sessionToDays drives "session fully processed only after its last
// day has been written" downstream in computeJustCompletedSessions.
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

// The archivist occasionally asks to "append" to a brand-new topic; silently promoting that to "create" removes a
// whole class of LLM mistakes without needing a schema rejection.
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

export function parseArchivistOutput(rawOutput: string): DailyArchivistOutput | null {
  const parsed = extractJsonObject(rawOutput);
  if (!isDailyArchivistOutput(parsed)) return null;
  return parsed;
}

// Mutates sessionToDays. A session is "complete" when its pending-days set is empty AFTER removing the current date.
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

export function advanceJournalState(prev: JournalState, justCompleted: readonly SessionFileMeta[], newTopicsSeen: ReadonlySet<string>): JournalState {
  return {
    ...prev,
    processedSessions: applyProcessed(prev.processedSessions, [...justCompleted]),
    knownTopics: [...newTopicsSeen].sort(),
  };
}

// Malformed sessions are logged and skipped so one bad jsonl can't crash the pass.
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

// Reject non-object JSON (null, arrays, primitives) — entry.type would throw on them, and downstream parseEntry can't consume them.
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

// Uses fallbackDate for every event because the legacy jsonl format has no per-event timestamps.
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

export interface ParsedEntry {
  excerpt: SessionEventExcerpt;
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

// Prefer parseEntry for code that also wants artifact paths; this form is kept for the existing unit tests.
export function entryToExcerpt(entry: Record<string, unknown>): SessionEventExcerpt | null {
  const source = typeof entry.source === "string" ? entry.source : "unknown";
  const type = typeof entry.type === "string" ? entry.type : "unknown";

  if (type === EVENT_TYPES.text && typeof entry.message === "string") {
    return {
      source,
      type,
      content: truncate(entry.message, MAX_EVENT_CONTENT_CHARS),
    };
  }
  // typeof null === "object", so isRecord must reject null before accessing resultRecord.toolName below.
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

// Tool-aware extraction: different plugins stash file paths in different places inside tool_result data.
export function extractArtifactPaths(entry: Record<string, unknown>): string[] {
  if (entry.type !== "tool_result") return [];
  const result = entry.result;
  if (!isRecord(result)) return [];
  const resultRecord = result as Record<string, unknown>;
  const data = resultRecord.data;
  if (!isRecord(data)) return [];
  const dataRecord = data as Record<string, unknown>;
  const paths: string[] = [];

  // presentMulmoScript / presentHtml expose filePath directly.
  if (typeof dataRecord.filePath === "string" && dataRecord.filePath.length > 0) {
    paths.push(dataRecord.filePath);
  }

  // manageWiki only surfaces pageName; synthesise the path from the wiki/pages/<pageName>.md convention.
  if (resultRecord.toolName === "manageWiki" && typeof dataRecord.pageName === "string") {
    paths.push(`wiki/pages/${dataRecord.pageName}.md`);
  }

  return paths.filter(isSafeWorkspacePath);
}

// Refuse absolute paths, parent-escapes, scheme-like strings — guards against a malformed tool result wedging an
// absolute filesystem path into the archivist prompt.
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
