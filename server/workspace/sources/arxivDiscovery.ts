// arXiv auto-discovery (#469).
//
// Reads user interests from config/interests.json and automatically
// registers arXiv sources for keywords that don't already have one.
// Called from the pipeline's startup or on interest profile change.
//
// For each keyword (or group of related keywords), generates an
// arXiv query and registers it as a daily source. Existing arXiv
// sources are not duplicated.

import crypto from "crypto";
import { loadInterests } from "./interests.js";
import { listSources, writeSource } from "./registry.js";
import { sourcesRoot } from "./paths.js";
import { workspacePath } from "../paths.js";
import { log } from "../../system/logger/index.js";
import { slugify } from "../../utils/slug.js";
import type { Source } from "./types.js";
import { mkdirSync } from "fs";

// ── Constants ───────────────────────────────────────────────────

const ARXIV_SLUG_PREFIX = "arxiv-auto-";
const MAX_AUTO_SOURCES = 10;
const DEFAULT_MAX_ITEMS = 20;

// ── Query building ──────────────────────────────────────────────

/**
 * Build an arXiv query string from a list of keywords.
 * Searches in title and abstract fields. Double quotes in keywords
 * are stripped (not escaped) so the arXiv query stays valid.
 * Example: ["transformer", "attention"] → 'ti:"transformer" OR abs:"transformer" OR ti:"attention" OR abs:"attention"'
 */
export function buildArxivQuery(keywords: readonly string[]): string {
  const terms = keywords.flatMap((keyword) => {
    const stripped = keyword.replace(/"/g, "");
    return [`ti:"${stripped}"`, `abs:"${stripped}"`];
  });
  return terms.join(" OR ");
}

/**
 * Generate a slug from keywords. Uses a short hash of all keywords
 * to avoid collisions when chunks share the same leading words or
 * when keywords are non-ASCII (CJK, etc.).
 * Example: ["WebAssembly", "WASM"] → "arxiv-auto-webassembly-wasm-a1b2"
 */
export function keywordsToSlug(keywords: readonly string[]): string {
  const latin = keywords
    .map((keyword) => slugify(keyword, ""))
    .filter((slugPart) => slugPart.length > 0)
    .slice(0, 3)
    .join("-");
  // Short hash of ALL keywords ensures uniqueness even when the
  // Latin portion is empty (non-ASCII) or identical across chunks.
  const hash = crypto.createHash("sha256").update(keywords.join("|")).digest("hex").slice(0, 6);
  const base = latin ? `${latin}-${hash}` : hash;
  return `${ARXIV_SLUG_PREFIX}${base}`;
}

/**
 * Generate a human-readable title from keywords.
 */
function keywordsToTitle(keywords: readonly string[]): string {
  return `arXiv: ${keywords.join(", ")}`;
}

// ── Discovery ───────────────────────────────────────────────────

export interface DiscoveryResult {
  registered: string[];
  skipped: string[];
  reason: string | null;
}

/**
 * Discover and register arXiv sources based on user interests.
 * Groups all keywords into a single arXiv query source.
 * Skips if the source already exists.
 */
export async function discoverAndRegister(root?: string): Promise<DiscoveryResult> {
  const base = root ?? workspacePath;
  const profile = loadInterests(base);
  if (!profile || profile.keywords.length === 0) {
    return { registered: [], skipped: [], reason: "no keywords in interests" };
  }

  // Ensure sources directory exists
  const dir = sourcesRoot(base);
  mkdirSync(dir, { recursive: true });

  const existing = await listSources(base);
  const existingSlugs = new Set(existing.map((source) => source.slug));

  const registered: string[] = [];
  const skipped: string[] = [];

  // Strategy: group keywords into chunks of ~5 for separate sources,
  // or put them all in one if few enough
  const chunks = chunkKeywords(profile.keywords, 5);

  for (const chunk of chunks.slice(0, MAX_AUTO_SOURCES)) {
    const slug = keywordsToSlug(chunk);

    if (existingSlugs.has(slug)) {
      skipped.push(slug);
      continue;
    }

    const query = buildArxivQuery(chunk);
    const source: Source = {
      slug,
      title: keywordsToTitle(chunk),
      url: `https://arxiv.org/search/?query=${encodeURIComponent(chunk.join(" "))}`,
      fetcherKind: "arxiv",
      fetcherParams: {
        arxiv_query: query,
        arxiv_sort: "submittedDate",
        arxiv_order: "descending",
      },
      schedule: "daily",
      categories: profile.categories.length > 0 ? profile.categories : ["papers"],
      maxItemsPerFetch: DEFAULT_MAX_ITEMS,
      addedAt: new Date().toISOString(),
      notes: `Auto-registered from interests.json keywords: ${chunk.join(", ")}`,
    };

    try {
      await writeSource(base, source);
      registered.push(slug);
      existingSlugs.add(slug);
      log.info("arxiv-discovery", "registered arXiv source", { slug, query });
    } catch (err) {
      log.warn("arxiv-discovery", "failed to register source", {
        slug,
        error: String(err),
      });
    }
  }

  return { registered, skipped, reason: null };
}

function chunkKeywords(keywords: readonly string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < keywords.length; i += size) {
    chunks.push(keywords.slice(i, i + size) as string[]);
  }
  return chunks;
}

/**
 * Remove auto-registered arXiv sources that no longer match
 * any keyword in the current interests profile.
 */
export async function pruneStaleAutoSources(root?: string): Promise<string[]> {
  const base = root ?? workspacePath;
  const profile = loadInterests(base);
  const existing = await listSources(base);
  const autoSources = existing.filter((source) => source.slug.startsWith(ARXIV_SLUG_PREFIX));

  if (autoSources.length === 0) return [];

  // If no profile at all, prune everything auto-registered
  const currentKeywords = profile ? new Set(profile.keywords.map((keyword) => keyword.toLowerCase())) : new Set<string>();

  const pruned: string[] = [];
  for (const source of autoSources) {
    const notes = (source.notes ?? "").toLowerCase();
    const hasMatch = [...currentKeywords].some((keyword) => notes.includes(keyword));
    if (!hasMatch && currentKeywords.size > 0) {
      // Keywords changed — this source is stale but don't delete,
      // just log. User can manually remove via manageSource.
      log.info("arxiv-discovery", "stale auto-source detected", {
        slug: source.slug,
      });
      pruned.push(source.slug);
    }
  }
  return pruned;
}
