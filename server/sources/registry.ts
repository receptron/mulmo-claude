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
import path from "node:path";
import {
  isFetcherKind,
  isSourceSchedule,
  type Source,
  type FetcherParams,
  type FetcherKind,
  type SourceSchedule,
} from "./types.js";
import { normalizeCategories } from "./taxonomy.js";
import type { CategorySlug } from "./taxonomy.js";
import { isValidSlug, sourceFilePath, sourcesRoot } from "./paths.js";
import { log } from "../logger/index.js";

// --- Frontmatter parsing ------------------------------------------------

// Fields we recognize as first-class on every source. Anything else
// in the frontmatter ends up in `fetcherParams` so a fetcher kind
// that needs extra config can read it without us adding yet
// another typed field for every new fetcher.
const RESERVED_KEYS = new Set([
  "slug",
  "title",
  "url",
  "fetcher_kind",
  "schedule",
  "categories",
  "max_items_per_fetch",
  "added_at",
]);

const FRONTMATTER_OPEN = /^---\r?\n/;
const FRONTMATTER_CLOSE = /\r?\n---\s*(\r?\n|$)/;

interface ParsedFrontmatter {
  fields: Map<string, string | string[]>;
  body: string;
}

// Extract YAML frontmatter + body. Returns null when the file has
// no frontmatter at all — that's an error condition for source
// files (we always write frontmatter), not a degraded mode.
export function parseSourceFile(raw: string): ParsedFrontmatter | null {
  if (!FRONTMATTER_OPEN.test(raw)) return null;
  const afterOpen = raw.replace(FRONTMATTER_OPEN, "");
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpen);
  if (!closeMatch || closeMatch.index === undefined) return null;
  const fmText = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  return { fields: parseFields(fmText), body };
}

function parseFields(fmText: string): Map<string, string | string[]> {
  const fields = new Map<string, string | string[]>();
  for (const line of fmText.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed) fields.set(parsed.key, parsed.value);
  }
  return fields;
}

function parseLine(
  line: string,
): { key: string; value: string | string[] } | null {
  if (!line.trim() || line.trimStart().startsWith("#")) return null;
  const colonIdx = line.indexOf(":");
  if (colonIdx <= 0) return null;
  const key = line.slice(0, colonIdx).trim();
  const rawValue = line.slice(colonIdx + 1).trim();
  if (!key) return null;
  return { key, value: parseValue(rawValue) };
}

function parseValue(raw: string): string | string[] {
  if (!raw) return "";
  const arrayMatch = /^\[(.*)\]$/.exec(raw);
  if (arrayMatch) {
    return arrayMatch[1]
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter((s) => s.length > 0);
  }
  return unquote(raw);
}

function unquote(s: string): string {
  // Double-quoted strings: yamlScalar writes JSON-compatible escape
  // sequences (\\ for \, \" for "), so JSON.parse reverses them in
  // one shot. Fall back to a plain strip if the string is
  // double-quoted but somehow malformed.
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  // Single-quoted scalars follow YAML's doubling convention: '' → '.
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

// --- Source validation / construction -----------------------------------

function stringField(
  fields: Map<string, string | string[]>,
  key: string,
): string | null {
  const v = fields.get(key);
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numberField(
  fields: Map<string, string | string[]>,
  key: string,
  defaultValue: number,
): number {
  const v = fields.get(key);
  if (typeof v !== "string") return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

// Default per-fetch cap. Fetchers treat it as a hint — if the
// upstream API returns fewer items naturally the fetcher MAY
// return fewer, but must NEVER return more than this.
export const DEFAULT_MAX_ITEMS_PER_FETCH = 30;

// Construct a Source from parsed frontmatter fields. Returns null
// on required-field validation failure. The `body` arg is inlined
// into the Source as `notes`.
export function buildSource(
  fields: Map<string, string | string[]>,
  body: string,
): Source | null {
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

  const maxItemsPerFetch = numberField(
    fields,
    "max_items_per_fetch",
    DEFAULT_MAX_ITEMS_PER_FETCH,
  );

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
    lines.push(
      source.notes.endsWith("\n") ? source.notes : `${source.notes}\n`,
    );
  } else {
    lines.push("");
  }
  return lines.join("\n");
}

// --- Filesystem I/O -----------------------------------------------------

// Load one source by slug. Returns null if missing, malformed, or
// fails required-field validation. Never throws — consumer code
// just skips null entries.
export async function readSource(
  workspaceRoot: string,
  slug: string,
): Promise<Source | null> {
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
  out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return out;
}

// Atomic write: stage to a sibling `.tmp` file then rename. Crash
// mid-write cannot leave a half-written source file behind.
export async function writeSource(
  workspaceRoot: string,
  source: Source,
): Promise<void> {
  if (!isValidSlug(source.slug)) {
    throw new Error(`[sources] invalid slug: ${source.slug}`);
  }
  const target = sourceFilePath(workspaceRoot, source.slug);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, serializeSource(source), "utf-8");
  await fsp.rename(tmp, target);
}

export async function deleteSource(
  workspaceRoot: string,
  slug: string,
): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  try {
    await fsp.unlink(sourceFilePath(workspaceRoot, slug));
    return true;
  } catch {
    return false;
  }
}
