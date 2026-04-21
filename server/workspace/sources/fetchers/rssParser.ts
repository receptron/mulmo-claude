// Pure RSS 2.0 + Atom 1.0 parser.
//
// Uses `fast-xml-parser` for the XML-decoding plumbing (CDATA,
// entity decoding, namespaces) and layers a feed-specific
// normalization on top. The output shape is format-agnostic:
// both RSS and Atom resolve into the same `ParsedFeedItem[]`.
//
// Pure — no I/O. Unit-testable with fixture strings.

import { XMLParser } from "fast-xml-parser";
import { isNonEmptyString, isRecord } from "../../../utils/types.js";

export interface ParsedFeedItem {
  // Best-effort stable identity from the feed itself. For RSS
  // this is <guid>; for Atom it's <id>. Falls back to <link>
  // when neither is present. The caller normalizes via
  // `stableItemId(normalizedUrl)` when dedup across sources is
  // needed, so this id is informational only.
  feedId: string | null;
  title: string;
  link: string | null;
  // RFC-822-ish date string from RSS <pubDate>, or RFC-3339
  // from Atom <updated>/<published>. Pre-normalized to a
  // JavaScript-parseable ISO string when possible; otherwise
  // passed through verbatim for the consumer to handle.
  publishedAt: string | null;
  // Short description. RSS <description> or Atom
  // <summary>/<content>. May contain HTML — the pipeline's
  // summarizer step will flatten it.
  summary: string | null;
  // Full HTML/text body when the feed provides one separately
  // from summary. Otherwise null.
  content: string | null;
}

export interface ParsedFeed {
  // "rss" or "atom" — callers rarely care but logging benefits
  // from knowing which branch parsed.
  kind: "rss" | "atom";
  title: string | null;
  items: ParsedFeedItem[];
}

// Configure the XML parser once at module load.
// - preserveOrder=false: we access elements by name, not by order
// - ignoreAttributes=false: Atom's <link href=...> matters
// - cdataPropName="#cdata": CDATA content lands in a predictable
//   key; we coalesce it with plain text content below
// - parseTagValue/parseAttributeValue=false: keep everything as
//   strings so weird "dates" like "2026/13/45" don't silently
//   become NaN
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Some feeds emit arrays of <item>/<entry> and some emit a
  // single one. alwaysCreateTextNode=false + isArray callbacks
  // below normalize both shapes to arrays.
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

// Parse an RSS or Atom feed body. Returns null when the input
// doesn't look like a feed we understand (wrong root element,
// unparseable XML). The pipeline treats null the same way it
// treats "zero new items" — logged + skipped.
export function parseFeed(body: string): ParsedFeed | null {
  const text = stripBom(body);
  if (!text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = xml.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  if (isRecord(parsed.rss)) return parseRss(parsed.rss);
  if (isRecord(parsed.feed)) return parseAtom(parsed.feed);
  // RDF 1.0 (RSS 1.0) uses <rdf:RDF> as the root. fast-xml-parser
  // keeps the namespace prefix on the key by default, so check
  // both the prefixed form and the unprefixed fallback.
  const rdf = parsed["rdf:RDF"] ?? parsed.RDF;
  if (isRecord(rdf)) return parseRss10(rdf);
  return null;
}

// --- RSS 2.0 ------------------------------------------------------------

function parseRss(rss: Record<string, unknown>): ParsedFeed | null {
  const channel = rss.channel;
  if (!isRecord(channel)) return null;
  const rawItems = Array.isArray(channel.item) ? channel.item : [];
  const items: ParsedFeedItem[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const parsed = parseRssItem(raw);
    if (parsed) items.push(parsed);
  }
  return {
    kind: "rss",
    title: readString(channel.title),
    items,
  };
}

function parseRssItem(raw: Record<string, unknown>): ParsedFeedItem | null {
  const title = readString(raw.title);
  // <guid> can be a plain string or `{ "#text": "...",
  // "@_isPermaLink": "false" }` depending on attributes.
  const guid = readString(raw.guid);
  const link = readString(raw.link);
  // <pubDate> is RFC 822. Convert to ISO for easier downstream
  // comparisons; fall back to the raw value if the conversion
  // fails (a malformed date is better than no date).
  const publishedAt = normalizeDate(readString(raw.pubDate));
  // <description> is the short summary. Some feeds also emit
  // <content:encoded> for the full HTML body. fast-xml-parser
  // keeps the namespace prefix on the key by default, so we
  // read both `content:encoded` (prefixed, the common case)
  // and a bare `encoded` key as a fallback for parsers that
  // stripped the namespace.
  // Fall back to content when <description> is absent so
  // content-only feeds (fairly common among tech blogs) don't
  // end up with a null summary — the summarizer intentionally
  // drops `content` so title-only items would otherwise slip in.
  const content = readString(raw["content:encoded"]) ?? readString(raw.encoded);
  const summary = readString(raw.description) ?? content;
  if (!title) return null;
  return {
    feedId: guid ?? link ?? null,
    title,
    link,
    publishedAt,
    summary,
    content,
  };
}

// --- RSS 1.0 (RDF) ------------------------------------------------------

function parseRss10(rdf: Record<string, unknown>): ParsedFeed | null {
  // RDF feeds put <item> directly under <rdf:RDF>, not under a
  // <channel>. Items are the same shape as RSS 2.0 otherwise.
  const rawItems = Array.isArray(rdf.item) ? rdf.item : [];
  const items: ParsedFeedItem[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const parsed = parseRssItem(raw);
    if (parsed) items.push(parsed);
  }
  const channel = isRecord(rdf.channel) ? rdf.channel : null;
  return {
    kind: "rss",
    title: channel ? readString(channel.title) : null,
    items,
  };
}

// --- Atom 1.0 -----------------------------------------------------------

function parseAtom(feed: Record<string, unknown>): ParsedFeed | null {
  const rawEntries = Array.isArray(feed.entry) ? feed.entry : [];
  const items: ParsedFeedItem[] = [];
  for (const raw of rawEntries) {
    if (!isRecord(raw)) continue;
    const parsed = parseAtomEntry(raw);
    if (parsed) items.push(parsed);
  }
  return {
    kind: "atom",
    title: readString(feed.title),
    items,
  };
}

function parseAtomEntry(raw: Record<string, unknown>): ParsedFeedItem | null {
  const title = readString(raw.title);
  const entryId = readString(raw.id);
  const link = resolveAtomLink(raw.link);
  const published = readString(raw.published) ?? readString(raw.updated) ?? null;
  const publishedAt = published ? normalizeDate(published) : null;
  // Same fallback story as RSS 2.0: content-only Atom entries
  // (e.g. GitHub-generated feeds) should still surface in the
  // summary step rather than be silently title-only.
  const content = readString(raw.content);
  const summary = readString(raw.summary) ?? content;
  if (!title) return null;
  return {
    feedId: entryId ?? link ?? null,
    title,
    link,
    publishedAt,
    summary,
    content,
  };
}

// Atom <link> has three shapes in the wild:
//   1. `<link>https://x.com/</link>` — plain string body (rare but
//      real, e.g. hand-written atom feeds)
//   2. `<link href="..." rel="alternate"/>` — attribute-bearing
//      element, which is the spec-canonical form
//   3. Multiple `<link>` elements with different `rel` values, a
//      mix of the above
//
// Because we set `isArray: name === "link"` on the parser, every
// link form arrives wrapped in an array. Within the array we may
// see plain strings (form 1) and objects with `@_href` (forms 2/3).
//
// Preference: rel="alternate" wins (canonical web URL). Otherwise
// we fall back to the first candidate that has a usable href /
// string value.
function resolveAtomLink(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  const candidates = Array.isArray(raw) ? raw : [raw];
  let fallback: string | null = null;
  for (const candidate of candidates) {
    const outcome = classifyAtomLinkCandidate(candidate);
    if (outcome.kind === "alternate") return outcome.href;
    if (outcome.kind === "fallback") fallback ??= outcome.href;
  }
  return fallback;
}

type AtomLinkOutcome = { kind: "alternate"; href: string } | { kind: "fallback"; href: string } | { kind: "skip" };

// Inspect one candidate from Atom's `<link>` list (which may be a
// plain string or an object carrying `@_href` / `@_rel` attrs)
// and report whether it's a rel="alternate" winner, a usable
// fallback, or nothing we can use.
function classifyAtomLinkCandidate(candidate: unknown): AtomLinkOutcome {
  if (isNonEmptyString(candidate)) {
    // Form 1: bare `<link>url</link>`. Unattributed → fallback.
    return { kind: "fallback", href: candidate };
  }
  if (!isRecord(candidate)) return { kind: "skip" };
  const href = readString(candidate["@_href"]);
  if (!href) return { kind: "skip" };
  const rel = readString(candidate["@_rel"]);
  if (rel === "alternate" || rel === null) {
    return { kind: "alternate", href };
  }
  return { kind: "fallback", href };
}

// --- helpers ------------------------------------------------------------

// isRecord moved to server/utils/types.ts

// Extract a string from a value that might be:
//   - a plain string
//   - an object with `#text` (tag with attributes + body text)
//   - an object with `#cdata` (CDATA-wrapped body)
//   - an array (pick the first non-empty)
// Returns null when nothing plausibly-textual is found.
function readString(value: unknown): string | null {
  if (isNonEmptyString(value)) return value;
  if (typeof value === "string") return null;
  if (isRecord(value)) return readStringFromRecord(value);
  if (Array.isArray(value)) return readStringFromArray(value);
  return null;
}

function readStringFromRecord(record: Record<string, unknown>): string | null {
  const text = record["#text"];
  if (isNonEmptyString(text)) return text;
  const cdata = record["#cdata"];
  if (isNonEmptyString(cdata)) return cdata;
  return null;
}

function readStringFromArray(array: readonly unknown[]): string | null {
  for (const entry of array) {
    const resolved = readString(entry);
    if (resolved !== null) return resolved;
  }
  return null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Convert a date string into ISO 8601 if possible; otherwise
// return the original. We never throw — a weird but non-empty
// date is more useful to the pipeline than a null.
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return raw;
}
