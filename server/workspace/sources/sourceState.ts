// Per-source runtime state I/O.
//
// State lives at `workspace/sources/_state/<slug>.json`, kept
// separate from the source config (`<slug>.md`) so the config
// is the git-tracked source of truth while state can grow /
// reset / get cleared without touching committed history.
//
// All functions take an explicit `workspaceRoot` so tests use
// mkdtempSync without touching real workspace state.

import fsp from "node:fs/promises";
import { defaultSourceState, type SourceState } from "./types.js";
import { isValidSlug, sourceStatePath } from "./paths.js";
import { errorMessage } from "../../utils/errors.js";
import { writeJsonAtomic } from "../../utils/files/index.js";

// Shallow-parse + type-guard one state record. Returns a
// default state (zeroed counters, empty cursor) when the file
// is missing, malformed, or any required field fails. Never
// throws.
export async function readSourceState(
  workspaceRoot: string,
  slug: string,
): Promise<SourceState> {
  if (!isValidSlug(slug)) return defaultSourceState(slug);
  let raw: string;
  try {
    raw = await fsp.readFile(sourceStatePath(workspaceRoot, slug), "utf-8");
  } catch {
    return defaultSourceState(slug);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultSourceState(slug);
  }
  return validateSourceState(parsed, slug);
}

// Runtime-validate an arbitrary parse result into a
// SourceState. Unknown fields are dropped; missing fields get
// default values; wrong-typed fields collapse to the default.
// Defensive: a hand-edited / corrupted state file should NOT
// crash the pipeline, it should quietly get rebuilt on the
// next successful run.
export function validateSourceState(raw: unknown, slug: string): SourceState {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return defaultSourceState(slug);
  }
  const o = raw as Record<string, unknown>;
  const lastFetchedAt =
    typeof o.lastFetchedAt === "string" ? o.lastFetchedAt : null;
  const nextAttemptAt =
    typeof o.nextAttemptAt === "string" ? o.nextAttemptAt : null;
  const consecutiveFailures =
    typeof o.consecutiveFailures === "number" &&
    Number.isFinite(o.consecutiveFailures) &&
    o.consecutiveFailures >= 0
      ? Math.floor(o.consecutiveFailures)
      : 0;
  const cursor = validateCursor(o.cursor);
  return {
    slug,
    lastFetchedAt,
    cursor,
    consecutiveFailures,
    nextAttemptAt,
  };
}

function validateCursor(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

// Atomic write: stage to `.tmp` then rename. Parent directory
// created as needed.
export async function writeSourceState(
  workspaceRoot: string,
  state: SourceState,
): Promise<void> {
  if (!isValidSlug(state.slug)) {
    throw new Error(`[sources/state] invalid slug: ${state.slug}`);
  }
  await writeJsonAtomic(sourceStatePath(workspaceRoot, state.slug), state);
}

// Convenience: read every state file listed for the given
// slugs. Used by the pipeline to gather per-source state before
// the fetch phase.
export async function readManyStates(
  workspaceRoot: string,
  slugs: readonly string[],
): Promise<Map<string, SourceState>> {
  const out = new Map<string, SourceState>();
  const reads = await Promise.all(
    slugs.map((slug) => readSourceState(workspaceRoot, slug)),
  );
  for (const state of reads) out.set(state.slug, state);
  return out;
}

// Convenience: write every state back in parallel. Failure on
// one state write is logged and absorbed — the daily run's
// summary has already landed on disk, a lost state update just
// means the next run re-fetches slightly more than needed.
export async function writeManyStates(
  workspaceRoot: string,
  states: readonly SourceState[],
): Promise<{ written: number; errors: string[] }> {
  const errors: string[] = [];
  let written = 0;
  for (const state of states) {
    try {
      await writeSourceState(workspaceRoot, state);
      written++;
    } catch (err) {
      errors.push(`[sources/state] ${state.slug}: ${errorMessage(err)}`);
    }
  }
  return { written, errors };
}

// Delete the state file for a slug. Used by `manageSource
// delete` so a removed source doesn't leave orphan state.
// Missing file is fine — returns false rather than throwing.
export async function deleteSourceState(
  workspaceRoot: string,
  slug: string,
): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  try {
    await fsp.unlink(sourceStatePath(workspaceRoot, slug));
    return true;
  } catch {
    return false;
  }
}

// Utility: sort outcomes by source slug so results are
// deterministic regardless of which fetcher finished first.
// Used by reporting / logging code.
export function sortBySlug<T extends { sourceSlug?: string; slug?: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    const ak = a.sourceSlug ?? a.slug ?? "";
    const bk = b.sourceSlug ?? b.slug ?? "";
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}
