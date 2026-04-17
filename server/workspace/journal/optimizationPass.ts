// Weekly-ish topic optimization pass: merge near-duplicates, move
// stale topics into archive/. Separate file from dailyPass so the
// two can evolve independently and so the optimizer stays opt-in
// from the top-level runner.

import fsp from "node:fs/promises";
import path from "node:path";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import {
  type Summarize,
  type OptimizationTopicSnapshot,
  OPTIMIZATION_SYSTEM_PROMPT,
  buildOptimizationUserPrompt,
  extractJsonObject,
  isOptimizationOutput,
  ClaudeCliNotFoundError,
} from "./archivist.js";
import {
  summariesRoot,
  topicPathFor,
  archivedTopicPathFor,
  slugify,
  TOPICS_DIR,
} from "./paths.js";
import type { JournalState } from "./state.js";
import { log } from "../../system/logger/index.js";

// How many characters of each topic file we hand to the optimizer.
// Enough to judge duplication without blowing up the prompt.
const OPTIMIZER_HEAD_CHARS = 500;

export interface OptimizationPassDeps {
  workspaceRoot?: string;
  summarize: Summarize;
}

export interface OptimizationPassResult {
  mergedSlugs: string[];
  archivedSlugs: string[];
  skipped: boolean;
  skippedReason?: string;
}

// Pure planner: turns the optimizer's raw merge instructions into a
// concrete list of slug-level operations. Empty merges (where every
// source resolves to the merge target itself) are dropped, and slugs
// are normalized via slugify so the I/O layer never has to.
export interface MergePlanItem {
  intoSlug: string;
  fromSlugs: string[];
  newContent: string;
}

export interface RawMerge {
  into: string;
  from: string[];
  newContent: string;
}

export function planMerges(merges: readonly RawMerge[]): MergePlanItem[] {
  const plans: MergePlanItem[] = [];
  for (const merge of merges) {
    const intoSlug = slugify(merge.into);
    const fromSlugs = merge.from.map(slugify).filter((s) => s !== intoSlug);
    if (fromSlugs.length === 0) continue;
    plans.push({ intoSlug, fromSlugs, newContent: merge.newContent });
  }
  return plans;
}

// Pure transform: returns the next JournalState with any slug in
// `removed` filtered out of knownTopics.
export function applyRemovedTopics(
  state: JournalState,
  removed: ReadonlySet<string>,
): JournalState {
  return {
    ...state,
    knownTopics: state.knownTopics.filter((t) => !removed.has(t)),
  };
}

async function executeMergePlans(
  workspaceRoot: string,
  plans: MergePlanItem[],
  removed: Set<string>,
  mergedSlugs: string[],
): Promise<void> {
  for (const plan of plans) {
    await writeFileAtomic(
      topicPathFor(workspaceRoot, plan.intoSlug),
      plan.newContent,
    );
    for (const src of plan.fromSlugs) {
      // Only record the merge as successful if the source file
      // actually moved. If moveToArchive fails (missing file, IO
      // error) we leave the source out of the removed set so the
      // in-memory knownTopics state stays accurate.
      if (!(await moveToArchive(workspaceRoot, src))) continue;
      removed.add(src);
      mergedSlugs.push(src);
    }
  }
}

async function executeArchives(
  workspaceRoot: string,
  rawSlugs: readonly string[],
  removed: Set<string>,
  archivedSlugs: string[],
): Promise<void> {
  for (const raw of rawSlugs) {
    const slug = slugify(raw);
    if (removed.has(slug)) continue;
    if (!(await moveToArchive(workspaceRoot, slug))) continue;
    removed.add(slug);
    archivedSlugs.push(slug);
  }
}

export async function runOptimizationPass(
  state: JournalState,
  deps: OptimizationPassDeps,
): Promise<{ nextState: JournalState; result: OptimizationPassResult }> {
  const workspaceRoot = deps.workspaceRoot ?? defaultWorkspacePath;
  const result: OptimizationPassResult = {
    mergedSlugs: [],
    archivedSlugs: [],
    skipped: false,
  };

  const topics = await loadTopicHeads(workspaceRoot);
  if (topics.length < 2) {
    // Nothing to optimise — need at least 2 topics for a merge to
    // be meaningful, and archiving a single topic would leave an
    // empty journal which feels wrong.
    result.skipped = true;
    result.skippedReason = "fewer than 2 topics";
    return { nextState: { ...state }, result };
  }

  let raw: string;
  try {
    raw = await deps.summarize(
      OPTIMIZATION_SYSTEM_PROMPT,
      buildOptimizationUserPrompt({ topics }),
    );
  } catch (err) {
    if (err instanceof ClaudeCliNotFoundError) throw err;
    log.warn("journal", "optimization summarize failed", {
      error: String(err),
    });
    result.skipped = true;
    result.skippedReason = "summarize failed";
    return { nextState: { ...state }, result };
  }

  const parsed = extractJsonObject(raw);
  if (!isOptimizationOutput(parsed)) {
    log.warn("journal", "optimizer returned unusable JSON, skipping");
    result.skipped = true;
    result.skippedReason = "unusable optimizer JSON";
    return { nextState: { ...state }, result };
  }

  const removed = new Set<string>();

  // Apply merges first, then archives (which skip slugs already
  // removed by a merge).
  await executeMergePlans(
    workspaceRoot,
    planMerges(parsed.merges),
    removed,
    result.mergedSlugs,
  );
  await executeArchives(
    workspaceRoot,
    parsed.archives,
    removed,
    result.archivedSlugs,
  );

  return { nextState: applyRemovedTopics(state, removed), result };
}

async function loadTopicHeads(
  workspaceRoot: string,
): Promise<OptimizationTopicSnapshot[]> {
  const dir = path.join(summariesRoot(workspaceRoot), TOPICS_DIR);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out: OptimizationTopicSnapshot[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const slug = name.replace(/\.md$/, "");
    try {
      const full = await fsp.readFile(path.join(dir, name), "utf-8");
      out.push({
        slug,
        headContent: full.slice(0, OPTIMIZER_HEAD_CHARS),
      });
    } catch {
      // ignore
    }
  }
  return out;
}

// Move a topic file into archive/topics/. Returns true on success,
// false if the source didn't exist or rename failed — the caller
// uses the boolean to decide whether to update state for this slug.
async function moveToArchive(
  workspaceRoot: string,
  slug: string,
): Promise<boolean> {
  const src = topicPathFor(workspaceRoot, slug);
  const dst = archivedTopicPathFor(workspaceRoot, slug);
  try {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.rename(src, dst);
    return true;
  } catch (err) {
    // Source may not exist (e.g. the LLM named a slug that was
    // never a real file) or the rename hit an unexpected IO error.
    // Log and return false — the caller leaves state untouched for
    // this slug so the in-memory knownTopics stays accurate.
    log.warn("journal", "could not archive", { slug, error: String(err) });
    return false;
  }
}
