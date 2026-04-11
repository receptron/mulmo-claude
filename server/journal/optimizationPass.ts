// Weekly-ish topic optimization pass: merge near-duplicates, move
// stale topics into archive/. Separate file from dailyPass so the
// two can evolve independently and so the optimizer stays opt-in
// from the top-level runner.

import fsp from "node:fs/promises";
import path from "node:path";
import { workspacePath as defaultWorkspacePath } from "../workspace.js";
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
    // eslint-disable-next-line no-console
    console.warn(`[journal] optimization summarize failed:`, err);
    result.skipped = true;
    result.skippedReason = "summarize failed";
    return { nextState: { ...state }, result };
  }

  const parsed = extractJsonObject(raw);
  if (!isOptimizationOutput(parsed)) {
    // eslint-disable-next-line no-console
    console.warn(`[journal] optimizer returned unusable JSON, skipping`);
    result.skipped = true;
    result.skippedReason = "unusable optimizer JSON";
    return { nextState: { ...state }, result };
  }

  const removed = new Set<string>();

  // Apply merges first. If multiple merges reference the same slug,
  // the later merge wins — shouldn't happen in practice but
  // deterministic if it does.
  for (const merge of parsed.merges) {
    const intoSlug = slugify(merge.into);
    const fromSlugs = merge.from.map(slugify).filter((s) => s !== intoSlug);
    if (fromSlugs.length === 0) continue;

    await fsp.mkdir(path.dirname(topicPathFor(workspaceRoot, intoSlug)), {
      recursive: true,
    });
    await fsp.writeFile(
      topicPathFor(workspaceRoot, intoSlug),
      merge.newContent,
      "utf-8",
    );

    for (const src of fromSlugs) {
      // Only record the merge as successful if the source file
      // actually moved. If moveToArchive fails (missing file, IO
      // error) we leave the source out of the removed set so the
      // in-memory knownTopics state stays accurate.
      const moved = await moveToArchive(workspaceRoot, src);
      if (!moved) continue;
      removed.add(src);
      result.mergedSlugs.push(src);
    }
  }

  // Apply archives (skip any already removed by a merge).
  for (const rawSlug of parsed.archives) {
    const slug = slugify(rawSlug);
    if (removed.has(slug)) continue;
    const moved = await moveToArchive(workspaceRoot, slug);
    if (!moved) continue;
    removed.add(slug);
    result.archivedSlugs.push(slug);
  }

  const nextKnownTopics = state.knownTopics.filter((t) => !removed.has(t));
  const nextState: JournalState = {
    ...state,
    knownTopics: nextKnownTopics,
  };

  return { nextState, result };
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
    // eslint-disable-next-line no-console
    console.warn(`[journal] could not archive ${slug}:`, err);
    return false;
  }
}
