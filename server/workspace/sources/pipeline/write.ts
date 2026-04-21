// Write-phase helpers for the source pipeline.
//
// Two responsibilities (kept pure where possible, with small
// async wrappers for the filesystem side):
//
//   1. Compose the daily file content — the LLM-written markdown
//      brief + a trailing fenced JSON block the dashboard reads
//      without re-parsing markdown (#188 Q2).
//   2. Write the daily file + append every item to its
//      source-specific monthly archive under
//      `archive/<slug>/YYYY/MM.md` (#188 Q4).

import fsp from "node:fs/promises";
import path from "node:path";
import { archivePath, dailyNewsPath } from "../paths.js";
import { errorMessage } from "../../../utils/errors.js";
import type { SourceItem } from "../types.js";
import { writeFileAtomic } from "../../../utils/files/index.js";

// --- JSON index --------------------------------------------------------

// Compact shape of the JSON block appended at the bottom of each
// daily file. Mirrors what the dashboard (#143) expects:
//   - itemCount: total items across all categories
//   - byCategory: per-slug counts, sorted-by-count-desc for
//     quick "which genre was hot today" read
//   - items: the raw per-item metadata (no body, no summary) so
//     the dashboard can render compact cards
export interface DailyJsonIndex {
  itemCount: number;
  byCategory: Record<string, number>;
  items: Array<{
    id: string;
    title: string;
    url: string;
    publishedAt: string;
    categories: string[];
    sourceSlug: string;
    severity?: string;
  }>;
}

export function buildDailyJsonIndex(items: readonly SourceItem[]): DailyJsonIndex {
  const byCategory: Record<string, number> = {};
  for (const item of items) {
    for (const cat of item.categories) {
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    }
  }
  return {
    itemCount: items.length,
    byCategory,
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      categories: [...item.categories],
      sourceSlug: item.sourceSlug,
      ...(item.severity !== undefined && { severity: item.severity }),
    })),
  };
}

// Assemble the full markdown file: claude's brief + a trailing
// ```json block with the structured index. Pure.
//
// `markdown` is the LLM output verbatim (it's supposed to end
// with a trailing newline already; we guard both cases). The
// JSON block always ends with a final newline so editors don't
// complain about "no newline at end of file".
export function assembleDailyFile(markdown: string, items: readonly SourceItem[]): string {
  const trimmed = markdown.endsWith("\n") ? markdown.slice(0, -1) : markdown;
  const index = buildDailyJsonIndex(items);
  // Pretty-printed JSON — the daily file is meant to be
  // readable in a text editor as much as machine-consumable.
  const json = JSON.stringify(index, null, 2);
  return `${trimmed}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}

// --- daily file write ---------------------------------------------------

// Atomic write: stage to a sibling `.tmp` then rename. Crash
// mid-write can't leave a half-written daily file visible to
// downstream readers.
export async function writeDailyFile(workspaceRoot: string, isoDate: string, markdown: string, items: readonly SourceItem[]): Promise<string> {
  const target = dailyNewsPath(workspaceRoot, isoDate);
  await writeFileAtomic(target, assembleDailyFile(markdown, items));
  return target;
}

// --- per-source archive append -----------------------------------------

// Each item lands in its source's monthly archive file under
// `archive/<slug>/YYYY/MM.md`. Per-month bucket chosen in
// #188 Q4 — keeps single-year browsing doable without per-day
// explosion.

// Pure: render one item as the markdown block we append to the
// archive. Exported for tests; idempotent-safe so re-appending
// the same item produces the same bytes.
export function renderItemForArchive(item: SourceItem): string {
  const lines: string[] = [];
  lines.push(`## ${item.title}`);
  lines.push("");
  lines.push(`- **Published:** ${item.publishedAt}`);
  lines.push(`- **Source:** ${item.sourceSlug}`);
  lines.push(`- **URL:** ${item.url}`);
  if (item.categories.length > 0) {
    lines.push(`- **Categories:** ${item.categories.join(", ")}`);
  }
  if (item.severity) {
    lines.push(`- **Severity:** ${item.severity}`);
  }
  if (item.summary) {
    lines.push("");
    lines.push(item.summary);
  }
  if (item.content && item.content !== item.summary) {
    lines.push("");
    lines.push(item.content);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

// ISO `publishedAt` → `YYYY-MM` used as the archive-month key.
// Malformed dates fall back to the caller-supplied default
// (typically the current YYYY-MM) so we don't drop items.
export function archiveMonthFor(isoPublishedAt: string, fallbackMonth: string): string {
  const ts = Date.parse(isoPublishedAt);
  if (!Number.isFinite(ts)) return fallbackMonth;
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${String(month).padStart(2, "0")}`;
}

// Group items by (sourceSlug, YYYY-MM) so each destination file
// gets one append instead of many. Exported so the orchestrator
// can size the concurrency and tests can pin the bucketing logic.
export function groupItemsForArchive(items: readonly SourceItem[], fallbackMonth: string): Map<string, SourceItem[]> {
  const groups = new Map<string, SourceItem[]>();
  for (const item of items) {
    const month = archiveMonthFor(item.publishedAt, fallbackMonth);
    const key = `${item.sourceSlug}::${month}`;
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

// Append every item's rendered markdown block to the appropriate
// `archive/<slug>/YYYY/MM.md`. Idempotency is the caller's
// responsibility (deduping via `stableItemId` earlier in the
// pipeline) — this helper blindly appends.
//
// Errors on individual source groups are collected, not thrown,
// so one bad group can't lose the others. Returns the list of
// successfully-written archive paths.
export async function appendItemsToArchives(
  workspaceRoot: string,
  items: readonly SourceItem[],
  fallbackMonth: string,
): Promise<{ writtenPaths: string[]; errors: string[] }> {
  const writtenPaths: string[] = [];
  const errors: string[] = [];
  const groups = groupItemsForArchive(items, fallbackMonth);
  for (const [key, groupItems] of groups) {
    const [slug, month] = key.split("::");
    try {
      const target = archivePath(workspaceRoot, slug, month);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const body = groupItems.map(renderItemForArchive).join("");
      await fsp.appendFile(target, body, "utf-8");
      writtenPaths.push(target);
    } catch (err) {
      errors.push(`[sources/archive] ${slug}/${month}: ${errorMessage(err)}`);
    }
  }
  return { writtenPaths, errors };
}
