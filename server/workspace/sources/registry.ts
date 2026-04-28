// Read / write source registry files under `workspace/sources/`.
//
// On-disk format — one markdown file per source:
//
//   ---
//   slug: hn-front-page
//   title: Hacker News front page
//   url: https://news.ycombinator.com/rss
//   fetcher_kind: rss
//   schedule: daily
//   categories: [tech-news, general, english]
//   max_items_per_fetch: 30
//   added_at: 2026-04-13T09:00:00Z
//   <fetcher-specific params as flat key: value>
//   ---
//
//   # Notes
//
//   Free-form markdown body. Claude reads it for context when
//   summarizing.
//
// Parser policy:
//
// - Flat YAML only. Nested mappings are not supported by design —
//   the frontmatter is hand-edited by humans and the LLM, both of
//   which routinely get nesting wrong. Fetcher params are flat
//   strings (e.g. `github_repo: foo/bar`) so the fetcher itself
//   interprets them.
// - Unknown frontmatter keys are preserved as opaque strings in
//   `fetcherParams`, so future fetchers can add fields without
//   round-trip data loss.
// - Missing required fields → the loader returns `null` and logs
//   a warning; the caller skips that source rather than crashing
//   the pass.
//
// The writer preserves the body text verbatim so re-saving a file
// doesn't rewrite the user's notes.

import fsp from "node:fs/promises";
import { isFetcherKind, isSourceSchedule, type Source, type FetcherParams, type FetcherKind, type SourceSchedule } from "./types.js";
import { normalizeCategories } from "./taxonomy.js";
import type { CategorySlug } from "./taxonomy.js";
import { writeFileAtomic } from "../../utils/files/index.js";
import { parseFrontmatter } from "../../utils/markdown/frontmatter.js";
import { sourceFilePath, sourcesRoot } from "./paths.js";
import { isValidSlug } from "../../utils/slug.js";
import { isNonEmptyString } from "../../utils/types.js";
import { log } from "../../system/logger/index.js";

// --- Frontmatter parsing ------------------------------------------------

// Fields we recognize as first-class on every source. Anything else
// in the frontmatter ends up in `fetcherParams` so a fetcher kind
// that needs extra config can read it without us adding yet
// another typed field for every new fetcher.
const RESERVED_KEYS = new Set(["slug", "title", "url", "fetcher_kind", "schedule", "categories", "max_items_per_fetch", "added_at"]);

interface ParsedFrontmatter {
  fields: Map<string, string | string[]>;
  body: string;
}

// Coerce shared `parseFrontmatter` output into the legacy
// `Map<string, string | string[]>` shape `buildSource` already
// understands. The new util parses with FAILSAFE_SCHEMA so scalars
// arrive as strings, which is exactly what this consumer wants.
// Sequences become string arrays (filtered for string entries —
// nested objects in a sources file are unusable here).
//
// `null` is coerced to the empty string so a bare `foo:` line (a
// legitimate way to declare a fetcher param with no value) is
// preserved in `fetcherParams`. The legacy line-by-line parser's
// `parseScalar` returned `""` for an empty raw value; matching
// that semantic keeps the round-trip contract that the existing
// test suite pins (codex review iter-2 #908).
function metaToLegacyFields(meta: Record<string, unknown>): Map<string, string | string[]> {
  const out = new Map<string, string | string[]>();
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === "string") {
      out.set(key, value);
    } else if (value === null) {
      out.set(key, "");
    } else if (Array.isArray(value)) {
      out.set(
        key,
        value.filter((item): item is string => typeof item === "string"),
      );
    }
    // Any other shape (nested object, number) is ignored — sources
    // files use flat YAML by design (see parser policy comment).
  }
  return out;
}

// Extract YAML frontmatter + body. Returns null when the file has
// no frontmatter at all — that's an error condition for source
// files (we always write frontmatter), not a degraded mode. Built
// on the shared `parseFrontmatter` helper so escape / array / line-
// ending edge cases match the rest of the codebase (#895 PR C).
export function parseSourceFile(raw: string): ParsedFrontmatter | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed.hasHeader) return null;
  return { fields: metaToLegacyFields(parsed.meta), body: parsed.body };
}

// --- Source validation / construction -----------------------------------

function stringField(fields: Map<string, string | string[]>, key: string): string | null {
  const value = fields.get(key);
  return isNonEmptyString(value) ? value : null;
}

function numberField(fields: Map<string, string | string[]>, key: string, defaultValue: number): number {
  const value = fields.get(key);
  if (typeof value !== "string") return defaultValue;
  const parsedNumber = Number(value);
  return Number.isFinite(parsedNumber) && parsedNumber > 0 ? Math.floor(parsedNumber) : defaultValue;
}

// Default per-fetch cap. Fetchers treat it as a hint — if the
// upstream API returns fewer items naturally the fetcher MAY
// return fewer, but must NEVER return more than this.
export const DEFAULT_MAX_ITEMS_PER_FETCH = 30;

// Construct a Source from parsed frontmatter fields. Returns null
// on required-field validation failure. The `body` arg is inlined
// into the Source as `notes`.
export function buildSource(fields: Map<string, string | string[]>, body: string): Source | null {
  const slug = stringField(fields, "slug");
  if (!slug || !isValidSlug(slug)) return null;

  const title = stringField(fields, "title");
  if (!title) return null;

  const url = stringField(fields, "url");
  if (!url) return null;

  const fetcherKindRaw = stringField(fields, "fetcher_kind");
  if (!isFetcherKind(fetcherKindRaw)) return null;
  const fetcherKind: FetcherKind = fetcherKindRaw;

  const scheduleRaw = stringField(fields, "schedule");
  if (!isSourceSchedule(scheduleRaw)) return null;
  const schedule: SourceSchedule = scheduleRaw;

  const categoriesRaw = fields.get("categories");
  const categories: CategorySlug[] = normalizeCategories(categoriesRaw);

  const maxItemsPerFetch = numberField(fields, "max_items_per_fetch", DEFAULT_MAX_ITEMS_PER_FETCH);

  const addedAt = stringField(fields, "added_at") ?? new Date(0).toISOString();

  // Collect unrecognized fields into fetcherParams. Only flat
  // string values — array values would indicate a schema mismatch
  // since no fetcher param is a list today.
  const fetcherParams: FetcherParams = {};
  for (const [key, value] of fields.entries()) {
    if (RESERVED_KEYS.has(key)) continue;
    if (typeof value === "string") fetcherParams[key] = value;
  }

  return {
    slug,
    title,
    url,
    fetcherKind,
    fetcherParams,
    schedule,
    categories,
    maxItemsPerFetch,
    addedAt,
    notes: body,
  };
}

// --- Serialization ------------------------------------------------------

// Escape a scalar for use as a YAML value. Very conservative —
// wraps in double-quotes whenever the value contains any character
// that could be mis-parsed. Idempotent-safe: a round-trip through
// parseValue → yamlScalar preserves the semantic string.
function yamlScalar(value: string): string {
  // Quote whenever the raw value contains characters that would
  // confuse the flat-YAML parser or collide with a YAML reserved
  // glyph. Numbers, dates, booleans, null all get quoted too so
  // the reader always treats them as strings.
  const needsQuote =
    value === "" ||
    /[:#[\]{},&*?|<>=!%@`]/.test(value) ||
    /^\s|\s$/.test(value) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(value) ||
    /^[+-]?[\d.]/.test(value);
  if (needsQuote) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function yamlList(values: readonly string[]): string {
  return `[${values.map(yamlScalar).join(", ")}]`;
}

// Serialize a Source back to the canonical markdown-with-
// frontmatter shape. Reserved-key ordering is stable (nice for
// diffs) and fetcher-specific params come after in alphabetical
// order.
export function serializeSource(source: Source): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`slug: ${yamlScalar(source.slug)}`);
  lines.push(`title: ${yamlScalar(source.title)}`);
  lines.push(`url: ${yamlScalar(source.url)}`);
  lines.push(`fetcher_kind: ${yamlScalar(source.fetcherKind)}`);
  lines.push(`schedule: ${yamlScalar(source.schedule)}`);
  lines.push(`categories: ${yamlList(source.categories)}`);
  lines.push(`max_items_per_fetch: ${String(source.maxItemsPerFetch)}`);
  lines.push(`added_at: ${yamlScalar(source.addedAt)}`);
  const paramKeys = Object.keys(source.fetcherParams).sort();
  for (const key of paramKeys) {
    lines.push(`${key}: ${yamlScalar(source.fetcherParams[key])}`);
  }
  lines.push("---");
  lines.push("");
  // Preserve trailing newline semantics — if the notes were empty,
  // emit exactly one newline after the closing fence; otherwise
  // append the notes verbatim.
  if (source.notes.length > 0) {
    lines.push(source.notes.endsWith("\n") ? source.notes : `${source.notes}\n`);
  } else {
    lines.push("");
  }
  return lines.join("\n");
}

// --- Filesystem I/O -----------------------------------------------------

// Load one source by slug. Returns null if missing, malformed, or
// fails required-field validation. Never throws — consumer code
// just skips null entries.
export async function readSource(workspaceRoot: string, slug: string): Promise<Source | null> {
  if (!isValidSlug(slug)) return null;
  let raw: string;
  try {
    raw = await fsp.readFile(sourceFilePath(workspaceRoot, slug), "utf-8");
  } catch {
    return null;
  }
  const parsed = parseSourceFile(raw);
  if (!parsed) return null;
  const source = buildSource(parsed.fields, parsed.body);
  // Sanity: filename slug must match frontmatter slug. A mismatch
  // indicates the user renamed the file without editing the header
  // (or vice-versa) — refuse the load rather than silently using
  // the wrong slug.
  if (source && source.slug !== slug) return null;
  return source;
}

// List every source in the registry. Files that fail to parse are
// logged and skipped; a single bad source file must not break the
// daily pipeline for all the others.
export async function listSources(workspaceRoot: string): Promise<Source[]> {
  const dir = sourcesRoot(workspaceRoot);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out: Source[] = [];
  for (const name of entries) {
    // Skip meta files and the `_state/` subdirectory.
    if (name.startsWith("_")) continue;
    if (!name.endsWith(".md")) continue;
    const slug = name.slice(0, -".md".length);
    const source = await readSource(workspaceRoot, slug);
    if (source) out.push(source);
    else {
      log.warn("sources", "failed to load source, skipping", { slug });
    }
  }
  // Deterministic sort by slug so callers can rely on stable order.
  out.sort((leftSource, rightSource) => (leftSource.slug < rightSource.slug ? -1 : leftSource.slug > rightSource.slug ? 1 : 0));
  return out;
}

// Atomic write: stage to a sibling `.tmp` file then rename. Crash
// mid-write cannot leave a half-written source file behind.
export async function writeSource(workspaceRoot: string, source: Source): Promise<void> {
  if (!isValidSlug(source.slug)) {
    throw new Error(`[sources] invalid slug: ${source.slug}`);
  }
  await writeFileAtomic(sourceFilePath(workspaceRoot, source.slug), serializeSource(source));
}

export async function deleteSource(workspaceRoot: string, slug: string): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  try {
    await fsp.unlink(sourceFilePath(workspaceRoot, slug));
    return true;
  } catch {
    return false;
  }
}
