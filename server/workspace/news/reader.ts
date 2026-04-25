// News-viewer reader (#761).
//
// Pure parsing helpers for the news files the source pipeline already
// writes:
//   - artifacts/news/daily/YYYY/MM/DD.md   (trailing ```json``` index)
//   - artifacts/news/archive/<slug>/YYYY/MM.md (per-item markdown blocks)
//
// The reader strategy is "no separate index" (issue #761 design): we
// walk N daily files on demand and aggregate in memory. Cheap enough
// for ~30 days; if we ever need full history we'll add a sidecar index
// in the pipeline write phase.
//
// All functions in this module are pure where possible — fs access
// is delegated to a thin async wrapper at the bottom so the parser
// is unit-testable without a workspace.
//
// Item shape mirrors the `DailyJsonIndex.items[]` element produced by
// `server/workspace/sources/pipeline/write.ts`. Re-declared here (vs.
// imported) so the news viewer doesn't depend on the pipeline's
// internal types.

import fsp from "node:fs/promises";
import path from "node:path";
import { dailyNewsPath, archivePath } from "../sources/paths.js";

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  categories: string[];
  sourceSlug: string;
  severity?: string;
}

interface DailyJsonShape {
  itemCount?: number;
  byCategory?: Record<string, number>;
  items?: NewsItem[];
}

// Walk the markdown linearly to find the LAST ```json ... ``` fence
// block. We split on lines (rather than a single `[\s\S]*?` regex)
// so the matcher is O(n) and immune to catastrophic backtracking on
// pathological inputs.
function findLastJsonFenceBlock(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  let lastBlock: string | null = null;
  let openAt = -1;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (openAt === -1 && line.trim() === "```json") {
      openAt = lineIdx;
      continue;
    }
    if (openAt !== -1 && line.trim() === "```") {
      lastBlock = lines.slice(openAt + 1, lineIdx).join("\n");
      openAt = -1;
    }
  }
  return lastBlock;
}

// Pull the last fenced ```json``` block out of a daily markdown
// file and parse it. Returns null on any structural problem so a
// single corrupt file can't take down the aggregator.
//
// We match the LAST ````json` fence rather than the
// first because the daily LLM brief sometimes contains illustrative
// JSON snippets earlier in the body. The pipeline always appends the
// real index as the trailing fence in `assembleDailyFile`.
export function extractDailyJsonIndex(markdown: string): NewsItem[] | null {
  const lastBlock = findLastJsonFenceBlock(markdown);
  if (lastBlock === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(lastBlock);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const shape = parsed as DailyJsonShape;
  if (!Array.isArray(shape.items)) return null;
  // Defensive filter: drop entries that don't carry the fields the
  // viewer relies on.
  return shape.items.filter((item): item is NewsItem => {
    return (
      typeof item === "object" &&
      item !== null &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.url === "string" &&
      typeof item.publishedAt === "string" &&
      typeof item.sourceSlug === "string" &&
      Array.isArray(item.categories)
    );
  });
}

// Build the list of YYYY-MM-DD strings for the last `days` days
// ending today (UTC). Pure: takes today as a parameter so tests can
// pin it.
export function lastNDates(days: number, today: Date): string[] {
  const list: string[] = [];
  for (let offset = 0; offset < days; offset++) {
    const point = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
    const year = point.getUTCFullYear();
    const month = String(point.getUTCMonth() + 1).padStart(2, "0");
    const day = String(point.getUTCDate()).padStart(2, "0");
    list.push(`${year}-${month}-${day}`);
  }
  return list;
}

// Sort by publishedAt descending; stable on ties via id. Pure.
function compareItemsByPublishedDesc(left: NewsItem, right: NewsItem): number {
  if (left.publishedAt !== right.publishedAt) {
    return left.publishedAt < right.publishedAt ? 1 : -1;
  }
  return left.id < right.id ? 1 : -1;
}

// Dedupe a list of items by `id`, keeping the first occurrence so the
// caller's pre-sort is preserved. Pure.
export function dedupeById(items: readonly NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// Walk daily files for the last `days` (today inclusive), parse each,
// flatten + dedupe + sort. Missing files are skipped silently — a
// quiet day is normal.
export async function aggregateRecentItems(workspaceRoot: string, days: number, today: Date = new Date()): Promise<NewsItem[]> {
  const dates = lastNDates(days, today);
  const flat: NewsItem[] = [];
  for (const isoDate of dates) {
    const target = dailyNewsPath(workspaceRoot, isoDate);
    let content: string;
    try {
      content = await fsp.readFile(target, "utf-8");
    } catch {
      continue;
    }
    const items = extractDailyJsonIndex(content);
    if (!items) continue;
    flat.push(...items);
  }
  flat.sort(compareItemsByPublishedDesc);
  return dedupeById(flat);
}

// --- Archive body extraction -----------------------------------------

// Parse one archive markdown file and return the body text for the
// item whose URL matches `url`, or null if not found / no body.
//
// Each archive entry has the shape:
//
//   ## <title>
//
//   - **Published:** ISO
//   - **Source:** slug
//   - **URL:** https://...
//   - **Categories:** ...
//   - (optional **Severity:**)
//
//   <optional summary>
//
//   <optional longer content>
//
//   ---
//
// Pure helper: given the lines of one archive block, return the
// post-metadata body text or null if there's nothing after the
// metadata bullets.
function extractBodyFromBlockLines(lines: readonly string[]): string | null {
  let lastMetaIdx = -1;
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    if (lines[lineIdx].startsWith("- **")) lastMetaIdx = lineIdx;
  }
  if (lastMetaIdx === -1) return null;
  let bodyStart = lastMetaIdx + 1;
  while (bodyStart < lines.length && lines[bodyStart].trim() === "") {
    bodyStart++;
  }
  if (bodyStart >= lines.length) return null;
  const body = lines.slice(bodyStart).join("\n").trim();
  return body.length > 0 ? body : null;
}

// Strategy: split on a line of `---`, for each block locate the URL
// metadata bullet, return the post-metadata text if it matches.
export function extractItemBodyFromArchive(markdown: string, url: string): string | null {
  // The render uses `---` as a separator on its own line. Splitting
  // on `\n---\n` (or `\n---\r\n`) keeps each block intact.
  const blocks = markdown.split(/\n---\r?\n/);
  const matchedBlock = blocks.find((block) => block.includes(`**URL:** ${url}`));
  if (matchedBlock === undefined) return null;
  return extractBodyFromBlockLines(matchedBlock.split(/\r?\n/));
}

// Convenience wrapper: find an item's body across all candidate
// archive files. Tries the YYYY-MM derived from `publishedAt` first;
// falls back to scanning sibling months if the entry was filed in a
// different bucket (e.g. timezone bleed at month boundary).
export async function loadItemBody(workspaceRoot: string, sourceSlug: string, url: string, publishedAt: string): Promise<string | null> {
  const monthCandidates = candidateMonths(publishedAt);
  for (const month of monthCandidates) {
    const target = archivePath(workspaceRoot, sourceSlug, month);
    let content: string;
    try {
      content = await fsp.readFile(target, "utf-8");
    } catch {
      continue;
    }
    const body = extractItemBodyFromArchive(content, url);
    if (body !== null) return body;
  }
  return null;
}

// `YYYY-MM` strings to try, ordered by likelihood: the publishedAt's
// own month, then ±1 month to handle timezone bleed at boundaries.
// Pure.
export function candidateMonths(isoPublishedAt: string): string[] {
  const parsed = Date.parse(isoPublishedAt);
  if (!Number.isFinite(parsed)) return [];
  const baseDate = new Date(parsed);
  const offsets = [0, -1, 1];
  return offsets.map((monthOffset) => {
    const point = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + monthOffset, 1));
    const year = point.getUTCFullYear();
    const month = String(point.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  });
}

// Re-export the item path helper so route handlers don't have to
// reach into the pipeline package.
export { archivePath, dailyNewsPath };
// node:path is intentionally re-exported for path-handling tests.
export const _internal = { path };
