import { workspacePath as defaultWorkspacePath } from "../workspace.js";
import { writeTopicFile, readAllTopicFiles, archiveTopic } from "../../utils/files/journal-io.js";
import {
  type OptimizationTopicSnapshot,
  OPTIMIZATION_SYSTEM_PROMPT,
  buildOptimizationUserPrompt,
  extractJsonObject,
  isOptimizationOutput,
} from "./archivist-schemas.js";
import { type Summarize, ClaudeCliNotFoundError } from "./archivist-cli.js";
import { slugify } from "./paths.js";
import type { JournalState } from "./state.js";
import { log } from "../../system/logger/index.js";

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

// Drops empty merges (every source resolves to the target itself); normalizes via slugify so the I/O layer never has to.
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
    const fromSlugs = merge.from.map(slugify).filter((slug) => slug !== intoSlug);
    if (fromSlugs.length === 0) continue;
    plans.push({ intoSlug, fromSlugs, newContent: merge.newContent });
  }
  return plans;
}

export function applyRemovedTopics(state: JournalState, removed: ReadonlySet<string>): JournalState {
  return {
    ...state,
    knownTopics: state.knownTopics.filter((topic) => !removed.has(topic)),
  };
}

async function executeMergePlans(workspaceRoot: string, plans: MergePlanItem[], removed: Set<string>, mergedSlugs: string[]): Promise<void> {
  for (const plan of plans) {
    await writeTopicFile(plan.intoSlug, plan.newContent, workspaceRoot);
    for (const src of plan.fromSlugs) {
      // Skip on archive failure so in-memory knownTopics stays accurate (the source file didn't actually move).
      if (!(await archiveTopic(src, workspaceRoot))) continue;
      removed.add(src);
      mergedSlugs.push(src);
    }
  }
}

async function executeArchives(workspaceRoot: string, rawSlugs: readonly string[], removed: Set<string>, archivedSlugs: string[]): Promise<void> {
  for (const raw of rawSlugs) {
    const slug = slugify(raw);
    if (removed.has(slug)) continue;
    if (!(await archiveTopic(slug, workspaceRoot))) continue;
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
    // Need at least 2 topics for a merge to be meaningful; archiving a sole topic would leave an empty journal.
    result.skipped = true;
    result.skippedReason = "fewer than 2 topics";
    return { nextState: { ...state }, result };
  }

  let raw: string;
  try {
    raw = await deps.summarize(OPTIMIZATION_SYSTEM_PROMPT, buildOptimizationUserPrompt({ topics }));
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

  // Merges first, then archives (which skip slugs already removed by a merge).
  await executeMergePlans(workspaceRoot, planMerges(parsed.merges), removed, result.mergedSlugs);
  await executeArchives(workspaceRoot, parsed.archives, removed, result.archivedSlugs);

  return { nextState: applyRemovedTopics(state, removed), result };
}

async function loadTopicHeads(workspaceRoot: string): Promise<OptimizationTopicSnapshot[]> {
  const topicMap = await readAllTopicFiles(workspaceRoot);
  const out: OptimizationTopicSnapshot[] = [];
  for (const [slug, content] of topicMap) {
    out.push({
      slug,
      headContent: content.slice(0, OPTIMIZER_HEAD_CHARS),
    });
  }
  return out;
}
