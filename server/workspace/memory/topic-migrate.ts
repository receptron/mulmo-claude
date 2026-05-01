// Atomic-to-topic migration (#1070 PR-A).
//
// Reads the existing #1029-style atomic entries from
// `conversations/memory/`, runs a clusterer, and writes the
// proposed topic layout to a STAGING dir
// `conversations/memory.next/`. Does NOT swap. The user runs
// `topic-swap.ts` after reviewing.
//
// Library only — `runTopicMigrationOnce` (in PR-B) decides when
// to call this from server startup.
//
// CLEANUP 2026-07-01: see `topic-run.ts` — this file is part of
// the one-shot atomic → topic migration chain and goes when the
// chain goes.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../../utils/files/atomic.js";
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { loadAllMemoryEntries } from "./io.js";
import { MEMORY_TYPES, type MemoryEntry, type MemoryType } from "./types.js";
import type { ClusterMap, ClusterTopic, MemoryClusterer } from "./topic-cluster.js";
import { MAX_TOPIC_SLUG_LENGTH } from "./topic-types.js";

export interface TopicMigrationResult {
  /** Whether anything was emitted to the staging dir. */
  noop: boolean;
  /** Atomic entries that fed the cluster call. */
  inputCount: number;
  /** Topic files written to the staging dir, per type. */
  topicCounts: Record<MemoryType, number>;
  /** Bullets the clusterer omitted (sum across types). */
  bulletsLost: number;
  /** Where the staging dir lives. */
  stagingPath: string;
}

export const STAGING_DIR_NAME = "memory.next";

export function topicStagingPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "conversations", STAGING_DIR_NAME);
}

interface WrittenTopic {
  type: MemoryType;
  topic: ClusterTopic;
  /** Slug actually written. May differ from `topic.topic` when a
   *  collision was resolved with a `-2` / `-3` suffix. */
  writtenSlug: string;
}

export async function clusterAtomicIntoStaging(workspaceRoot: string, clusterer: MemoryClusterer): Promise<TopicMigrationResult> {
  const entries = await loadAllMemoryEntries(workspaceRoot);
  const stagingPath = topicStagingPath(workspaceRoot);
  if (entries.length === 0) {
    return emptyResult(stagingPath);
  }
  log.info("memory", "topic-migrate: clustering", { entryCount: entries.length });
  // Wipe stale staging BEFORE the cluster call. If the clusterer
  // returns null or throws, we leave the workspace with no staging
  // dir at all — that's the correct "migration didn't complete"
  // signal. The earlier flow only cleared on success and could
  // leave a stale tree in place after a failed run, which a later
  // swap would happily promote.
  await resetStaging(stagingPath);
  let map: ClusterMap | null = null;
  try {
    map = await clusterer(entries);
  } catch (err) {
    log.error("memory", "topic-migrate: clusterer threw", { error: errorMessage(err) });
  }
  if (!map) {
    if (map === null) log.warn("memory", "topic-migrate: clusterer returned null");
    await rm(stagingPath, { recursive: true, force: true });
    return { ...emptyResult(stagingPath), inputCount: entries.length };
  }

  const result: TopicMigrationResult = {
    noop: false,
    inputCount: entries.length,
    topicCounts: { preference: 0, interest: 0, fact: 0, reference: 0 },
    bulletsLost: countBulletsLost(entries, map),
    stagingPath,
  };
  const written: WrittenTopic[] = [];
  for (const type of MEMORY_TYPES) {
    const usedSlugs = new Set<string>();
    for (const topic of map[type]) {
      const writtenSlug = pickUniqueSlug(topic.topic, usedSlugs);
      try {
        await writeTopicFileToStaging(stagingPath, type, topic, writtenSlug);
        usedSlugs.add(writtenSlug);
        written.push({ type, topic, writtenSlug });
        result.topicCounts[type] += 1;
      } catch (err) {
        log.warn("memory", "topic-migrate: write failed", { type, topic: topic.topic, writtenSlug, error: errorMessage(err) });
      }
    }
  }
  await writeStagingIndex(stagingPath, written);
  log.info("memory", "topic-migrate: staging ready", {
    stagingPath,
    topicCounts: result.topicCounts,
    bulletsLost: result.bulletsLost,
  });
  return result;
}

// Pick a slug that hasn't been used yet within this type. The
// clusterer may return two topics that would normalise to the same
// slug (e.g. "Music" and "music"); without this guard the second
// would silently overwrite the first.
//
// The base slug is trimmed if needed so `base + "-N"` still fits the
// `MAX_TOPIC_SLUG_LENGTH` cap that `isSafeTopicSlug` enforces. A
// 60-char slug colliding with a prior write would otherwise produce a
// 62-char filename that the writer rejects (and the reader would
// then refuse to load on the next session). After trimming we strip
// any trailing `-` so the suffix ("-N") is the only separator at the
// boundary.
function pickUniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let counter = 2;
  while (true) {
    const suffix = `-${counter}`;
    const room = MAX_TOPIC_SLUG_LENGTH - suffix.length;
    const trimmedBase = trimTrailingDash(base.slice(0, room));
    const candidate = trimmedBase.length > 0 ? `${trimmedBase}${suffix}` : `topic${suffix}`;
    if (!used.has(candidate)) return candidate;
    counter += 1;
  }
}

function trimTrailingDash(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === "-") end -= 1;
  return text.slice(0, end);
}

function emptyResult(stagingPath: string): TopicMigrationResult {
  return {
    noop: true,
    inputCount: 0,
    topicCounts: { preference: 0, interest: 0, fact: 0, reference: 0 },
    bulletsLost: 0,
    stagingPath,
  };
}

async function resetStaging(stagingPath: string): Promise<void> {
  // Stale staging from a prior run is wiped — the user's review
  // signal is the diff, so we always emit a fresh tree.
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });
}

async function writeTopicFileToStaging(stagingPath: string, type: MemoryType, topic: ClusterTopic, writtenSlug: string): Promise<void> {
  const dir = path.join(stagingPath, type);
  await mkdir(dir, { recursive: true });
  const absPath = path.join(dir, `${writtenSlug}.md`);
  const body = renderTopicBody(topic, writtenSlug);
  const content = `---\ntype: ${type}\ntopic: ${writtenSlug}\n---\n\n${body}`;
  await writeFileAtomic(absPath, content, { uniqueTmp: true });
}

function renderTopicBody(topic: ClusterTopic, writtenSlug: string): string {
  const heading = humaniseTopic(writtenSlug);
  const lines: string[] = [`# ${heading}`, ""];
  if (topic.unsectionedBullets && topic.unsectionedBullets.length > 0) {
    for (const bullet of topic.unsectionedBullets) {
      lines.push(`- ${bullet}`);
    }
    lines.push("");
  }
  if (topic.sections) {
    for (const section of topic.sections) {
      lines.push(`## ${section.heading}`, "");
      for (const bullet of section.bullets) {
        lines.push(`- ${bullet}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function humaniseTopic(slug: string): string {
  // ASCII-friendly humaniser: split on `-`, capitalise each word.
  // Non-ASCII slugs (which fall back to a hash) render as the slug
  // itself; the user can rename later in the file explorer.
  return slug
    .split("-")
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

// Build the staging-side `MEMORY.md` from the topics we successfully
// wrote to disk. Using the cluster map directly would link to files
// that failed to write (e.g. one bad slug would leave a broken index
// entry that swap promotes); this list is the disk-truth.
async function writeStagingIndex(stagingPath: string, written: WrittenTopic[]): Promise<void> {
  const lines: string[] = ["# Memory Index", ""];
  for (const type of MEMORY_TYPES) {
    const inType = written.filter((entry) => entry.type === type);
    if (inType.length === 0) continue;
    lines.push(`## ${type}`, "");
    const sorted = [...inType].sort((left, right) => left.writtenSlug.localeCompare(right.writtenSlug));
    for (const entry of sorted) {
      lines.push(formatStagingIndexLine(entry));
    }
    lines.push("");
  }
  if (written.length === 0) {
    lines.push("_(no entries yet)_", "");
  }
  await writeFileAtomic(path.join(stagingPath, "MEMORY.md"), lines.join("\n"), { uniqueTmp: true });
}

function formatStagingIndexLine(entry: WrittenTopic): string {
  const link = `${entry.type}/${entry.writtenSlug}.md`;
  const headings = (entry.topic.sections ?? []).map((section) => section.heading);
  if (headings.length === 0) return `- ${link}`;
  return `- ${link} — ${headings.join(", ")}`;
}

function countBulletsLost(entries: readonly MemoryEntry[], map: ClusterMap): number {
  let placed = 0;
  for (const type of MEMORY_TYPES) {
    for (const topic of map[type]) {
      if (topic.unsectionedBullets) placed += topic.unsectionedBullets.length;
      if (topic.sections) {
        for (const section of topic.sections) {
          placed += section.bullets.length;
        }
      }
    }
  }
  return Math.max(0, entries.length - placed);
}
