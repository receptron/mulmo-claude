// Per-session indexing logic. `indexSession` summarizes a single
// session jsonl and writes both a per-session file and a manifest
// upsert to workspace/chat/index/. `readManifest` is a tiny helper
// the sessions route uses to join entries into its /api/sessions
// response.
//
// All functions take an explicit `workspaceRoot` so tests can point
// at a `mkdtempSync` directory without touching the real
// ~/mulmoclaude.

import { readdir, readFile } from "node:fs/promises";
import { defaultSummarize, loadJsonlInput, type SummarizeFn } from "./summarizer.js";
import { chatDirFor, indexEntryPathFor, manifestPathFor, sessionJsonlPathFor, sessionMetaPathFor } from "./paths.js";
import type { ChatIndexEntry, ChatIndexManifest } from "./types.js";
import { writeJsonAtomic } from "../../utils/files/index.js";
import { DEFAULT_ROLE_ID } from "../../../src/config/roles.js";
import { ONE_MINUTE_MS } from "../../utils/time.js";
import { isRecord } from "../../utils/types.js";

// Freshness throttle: a session whose existing index entry is
// newer than this is skipped. The 15-minute window is a compromise
// — long enough that a single conversation doesn't re-summarize
// every turn, short enough that a user who leaves for lunch and
// comes back sees the title refresh.
export const MIN_INDEX_INTERVAL_MS = 15 * ONE_MINUTE_MS;

// Injection points for tests. Defaults are the production spawn +
// wall-clock.
export interface IndexerDeps {
  summarize?: SummarizeFn;
  now?: () => number;
  minIntervalMs?: number;
  // Bypass the `isFresh` freshness throttle. Used by the
  // backfill helper and the debug trigger endpoint so a manual
  // "rebuild everything" run doesn't silently skip entries that
  // happen to be within the 15-minute window.
  force?: boolean;
}

// --- manifest I/O ---------------------------------------------------

export async function readManifest(workspaceRoot: string): Promise<ChatIndexManifest> {
  try {
    const raw = await readFile(manifestPathFor(workspaceRoot), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (isManifest(parsed)) return parsed;
    return { version: 1, entries: [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

function isManifest(raw: unknown): raw is ChatIndexManifest {
  if (!isRecord(raw)) return false;
  const manifestRecord = raw as Record<string, unknown>;
  return manifestRecord.version === 1 && Array.isArray(manifestRecord.entries);
}

// In-process mutex serializing the read-modify-write sequence on
// the shared manifest file. Two concurrent `indexSession` calls
// for different session ids would otherwise both read an empty
// manifest, each append their own entry, and the last writer would
// clobber the first. Chain-based mutex keeps it simple and fits
// this module's single-process assumption.
let manifestMutex: Promise<void> = Promise.resolve();

async function withManifestLock<T>(lockedFn: () => Promise<T>): Promise<T> {
  const prev = manifestMutex;
  let release: () => void = () => {};
  manifestMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await prev;
    return await lockedFn();
  } finally {
    release();
  }
}

// Atomic write: stage to a per-call unique tmp file and rename.
// The unique suffix is belt-and-suspenders — the mutex above
// already serializes callers within this process, but a unique
// name means the rename can't collide even if a stray .tmp file
// is left behind by a previous crashed run.
async function writeManifestAtomic(workspaceRoot: string, manifest: ChatIndexManifest): Promise<void> {
  // `uniqueTmp` belt-and-suspenders: the in-process mutex above
  // already serializes callers, but a unique tmp name means the
  // rename can't collide even if a stray .tmp file is left behind
  // by a previous crashed run.
  await writeJsonAtomic(manifestPathFor(workspaceRoot), manifest, {
    uniqueTmp: true,
  });
}

// Read, mutate, and write the manifest under the in-process lock
// so concurrent callers cannot lose each other's updates.
export async function updateManifest(workspaceRoot: string, mutator: (m: ChatIndexManifest) => ChatIndexManifest): Promise<ChatIndexManifest> {
  return withManifestLock(async () => {
    const current = await readManifest(workspaceRoot);
    const next = mutator(current);
    await writeManifestAtomic(workspaceRoot, next);
    return next;
  });
}

// --- freshness check ------------------------------------------------

// A session is "fresh" when its per-session index file exists and
// was written less than `minIntervalMs` ago. Fresh sessions are
// skipped so a long conversation doesn't spam the CLI on every
// turn.
export async function isFresh(workspaceRoot: string, sessionId: string, now: number, minIntervalMs: number): Promise<boolean> {
  try {
    const raw = await readFile(indexEntryPathFor(workspaceRoot, sessionId), "utf-8");
    const entry: unknown = JSON.parse(raw);
    if (!isRecord(entry)) return false;
    const { indexedAt } = entry as Record<string, unknown>;
    if (typeof indexedAt !== "string") return false;
    const indexedTimestamp = Date.parse(indexedAt);
    if (Number.isNaN(indexedTimestamp)) return false;
    return now - indexedTimestamp < minIntervalMs;
  } catch {
    return false;
  }
}

// --- session metadata ----------------------------------------------

interface SessionMeta {
  roleId?: string;
  startedAt?: string;
}

async function readSessionMeta(workspaceRoot: string, sessionId: string): Promise<SessionMeta> {
  try {
    const raw = await readFile(sessionMetaPathFor(workspaceRoot, sessionId), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const metaRecord = parsed as Record<string, unknown>;
    return {
      roleId: typeof metaRecord.roleId === "string" ? metaRecord.roleId : undefined,
      startedAt: typeof metaRecord.startedAt === "string" ? metaRecord.startedAt : undefined,
    };
  } catch {
    return {};
  }
}

// List every session id that has a .jsonl file in the workspace
// chat dir. Used by the backfill helper.
export async function listSessionIds(workspaceRoot: string): Promise<string[]> {
  try {
    const files = await readdir(chatDirFor(workspaceRoot));
    return files.filter((fileName) => fileName.endsWith(".jsonl")).map((fileName) => fileName.slice(0, -".jsonl".length));
  } catch {
    return [];
  }
}

// --- the core indexSession call ------------------------------------

// Index (or re-index) a single session. Returns the entry on
// success, or null if the session was skipped (fresh, empty,
// missing). The only exception that escapes is
// `ClaudeCliNotFoundError` — the caller uses it to disable the
// module for the rest of the process lifetime.
export async function indexSession(workspaceRoot: string, sessionId: string, deps: IndexerDeps = {}): Promise<ChatIndexEntry | null> {
  const summarize = deps.summarize ?? defaultSummarize;
  const now = (deps.now ?? Date.now)();
  const minInterval = deps.minIntervalMs ?? MIN_INDEX_INTERVAL_MS;
  const force = deps.force === true;

  if (!force && (await isFresh(workspaceRoot, sessionId, now, minInterval))) {
    return null;
  }

  const input = await loadJsonlInput(sessionJsonlPathFor(workspaceRoot, sessionId));
  if (!input.trim()) return null;

  const summary = await summarize(input);
  const meta = await readSessionMeta(workspaceRoot, sessionId);

  const entry: ChatIndexEntry = {
    id: sessionId,
    roleId: meta.roleId ?? DEFAULT_ROLE_ID,
    startedAt: meta.startedAt ?? new Date(now).toISOString(),
    indexedAt: new Date(now).toISOString(),
    title: summary.title,
    summary: summary.summary,
    keywords: summary.keywords,
  };

  // Per-session file is written first so partial progress survives
  // a crash between the two writes: the next run can still observe
  // the fresh entry via isFresh and skip it.
  await writeJsonAtomic(indexEntryPathFor(workspaceRoot, sessionId), entry);

  // Upsert into manifest under the in-process lock: replace any
  // prior entry with the same id, sort newest-first by startedAt.
  await updateManifest(workspaceRoot, (current) => {
    const filtered = current.entries.filter((entryItem) => entryItem.id !== sessionId);
    filtered.push(entry);
    filtered.sort((leftEntry, rightEntry) => Date.parse(rightEntry.startedAt) - Date.parse(leftEntry.startedAt));
    return { version: 1, entries: filtered };
  });

  return entry;
}
