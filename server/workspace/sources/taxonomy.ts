// Fixed taxonomy of source categories. Keeping this a closed enum
// (rather than accepting free-form LLM-generated tags) prevents
// synonym sprawl — `ai` vs `artificial-intelligence` vs `AI` would
// otherwise all coexist and make filtering useless.
//
// The auto-categorizer (see plans/feat-source-registry.md §"Auto-
// categorization") classifies each new source into 1-5 of these
// slugs and writes them into the source file's frontmatter. Users
// can override by editing the file; the next daily run picks up
// the edits.
//
// Pin-tested so a silent enum mutation doesn't sneak past review.

export const CATEGORY_SLUGS = [
  "tech-news",
  "business-news",
  "ai",
  "security",
  "devops",
  "frontend",
  "backend",
  "ml-research",
  "dependencies",
  "product-updates",
  "japanese",
  "english",
  "papers",
  "general",
  "startup",
  "personal",
  // --- Phase-1 expansion (resolved from #188 open-question Q1) ---
  // Added to cover common genres the original 16 couldn't capture
  // (which were tech-centric and collapsed everything non-tech
  // into `general`). See plans/feat-source-registry.md §Resolved
  // decisions for rationale per slug.
  "finance",
  "design",
  "productivity",
  "science",
  "health",
  "gaming",
  "climate",
  "culture",
  "policy",
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORY_SLUGS);

// Runtime type-guard. Used when reading a source file from disk to
// drop any legacy / typo categories so downstream code only ever
// deals in the current enum.
export function isCategorySlug(value: unknown): value is CategorySlug {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

// Normalize an unknown list of category candidates into a clean,
// deduplicated array of valid slugs. Used when reading from
// frontmatter (where the user may have typo'd) and when receiving
// classifier output (where the LLM may have hallucinated a slug
// outside the taxonomy).
export function normalizeCategories(raw: unknown): CategorySlug[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<CategorySlug>();
  const out: CategorySlug[] = [];
  for (const item of raw) {
    if (isCategorySlug(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}
