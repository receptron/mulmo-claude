import { Router, Request, Response } from "express";
import path from "path";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { readTextSafeSync, readTextSafe } from "../../utils/files/safe.js";
import { writeWikiPage } from "../../workspace/wiki-pages/io.js";
import { getPageIndex } from "./wiki/pageIndex.js";
import { parseFrontmatterTags } from "./wiki/frontmatter.js";
import { badRequest, notFound } from "../../utils/httpError.js";
import { getOptionalStringQuery } from "../../utils/request.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { log } from "../../system/logger/index.js";
import { previewSnippet } from "../../utils/logPreview.js";
// Aliased because `buildPageResponseData` below declares a local
// string named `errorMessage`; importing the errors util under a
// different name avoids the no-shadow clash without renaming the
// long-standing local.
import { errorMessage as formatError } from "../../utils/errors.js";
import { BULLET_LINK_PATTERN, BULLET_WIKI_LINK_PATTERN } from "../../utils/regex.js";

const router = Router();

const pagesDir = () => WORKSPACE_PATHS.wikiPages;
const indexFile = () => WORKSPACE_PATHS.wikiIndex;
const logFile = () => WORKSPACE_PATHS.wikiLog;

function readFileOrEmpty(absPath: string): string {
  return readTextSafeSync(absPath) ?? "";
}

export interface WikiPageEntry {
  title: string;
  slug: string;
  description: string;
  tags: string[];
}

// Slug rules: lowercase, spaces to hyphens, strip everything that
// isn't a-z / 0-9 / hyphen. Used for both index parsing and page
// lookup so the two stay consistent.
export function wikiSlugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

const TABLE_SEPARATOR_PATTERN = /^\|[\s|:-]+\|$/;
// Bullet-link patterns (BULLET_LINK_PATTERN, BULLET_WIKI_LINK_PATTERN)
// live in `server/utils/regex.ts` alongside other server regex audit
// notes. Capture the href (group 2) alongside the title (group 1) so
// we can derive the slug from the file name instead of re-slugifying
// the title — important for non-ASCII titles like "さくらインターネット"
// where `wikiSlugify` returns "" and the slug would otherwise be lost.
// Unicode-aware tag body: any letter or number in any script
// (so Japanese / Chinese / Korean tags like `#クラウド` or `#可視化`
// work), plus `-` and `_` as internal joiners. First char is a
// letter or number only — no leading punctuation.
const HASHTAG_PATTERN = /(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;

// Extract `#tag` tokens from a bullet description, returning the
// stripped description and a sorted, deduped, lowercased tag list.
// Only matches at word boundaries so mid-word `#` (e.g. anchor URLs)
// is left alone.
export function extractHashTags(text: string): { description: string; tags: string[] } {
  const tags: string[] = [];
  HASHTAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HASHTAG_PATTERN.exec(text)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  const description = text.replace(HASHTAG_PATTERN, "").replace(/\s+/g, " ").trim();
  const deduped = [...new Set(tags)].sort();
  return { description, tags: deduped };
}

// Split a table Tags cell — tolerates comma, whitespace, or `#`
// prefixes. Empty cell yields an empty list.
export function parseTagsCell(cell: string): string[] {
  const tokens = cell
    .split(/[,\s]+/)
    .map((token) => token.trim().replace(/^#/, "").toLowerCase())
    .filter((token) => token.length > 0);
  return [...new Set(tokens)].sort();
}

// Map header cell names → column indices, case- and whitespace-
// tolerant. Used by `parseTableRow` to locate the Tags column (and
// any other named column) without assuming a fixed position, so
// older 3- and 4-column tables keep working.
export function buildTableColumnMap(headerRow: string): Map<string, number> {
  const cells = headerRow
    .split("|")
    .slice(1, -1)
    // Mirror `parseTableRow`'s cell-normalising: strip the surrounding
    // backticks that commonly wrap cell values in wiki tables. Without
    // this, a `| \`tags\` |` header maps to the key "`tags`" and the
    // subsequent `columnMap.get("tags")` lookup silently misses the
    // column, falling back to `tags: []`.
    .map((cell) => cell.trim().replace(/^`|`$/g, "").toLowerCase());
  const map = new Map<string, number>();
  cells.forEach((cell, i) => {
    if (cell) map.set(cell, i);
  });
  return map;
}

interface TableColumnIndices {
  slug: number;
  title: number;
  summary: number;
  /** Undefined when the table has no `tags` column — caller skips
   *  the tags lookup entirely and the row gets `tags: []`. */
  tags: number | undefined;
}

/** Resolve the per-column indices the row parser needs. Falls back
 *  to positional defaults (0/1/2) when the table has no header map.
 *  "summary" is the canonical column name; "description" is accepted
 *  as a legacy alias used by older fixtures. */
function resolveTableColumnIndices(columnMap: Map<string, number> | null): TableColumnIndices {
  return {
    slug: columnMap?.get("slug") ?? 0,
    title: columnMap?.get("title") ?? 1,
    summary: columnMap?.get("summary") ?? columnMap?.get("description") ?? 2,
    tags: columnMap?.get("tags"),
  };
}

// Each parser returns the entry it produced (if any). The parent
// loop tries them in order; the first non-null result wins.
function parseTableRow(trimmed: string, columnMap: Map<string, number> | null): WikiPageEntry | null {
  const cols = trimmed
    .split("|")
    .slice(1, -1)
    .map((column) => column.trim().replace(/^`|`$/g, ""));
  if (cols.length < 2) return null;

  const idx = resolveTableColumnIndices(columnMap);
  const slug = cols[idx.slug] ?? "";
  const title = cols[idx.title] || slug;
  if (!slug || !title) return null;

  const description = cols[idx.summary] ?? "";
  const tags = idx.tags !== undefined ? parseTagsCell(cols[idx.tags] ?? "") : [];
  return { title, slug, description, tags };
}

// Extract the slug segment from a bullet link's href. Accepts the
// canonical `pages/<slug>.md`, a bare `<slug>.md`, or just `<slug>`
// — the three forms produced by different historical writers of
// index.md. Returns "" for hrefs that don't look like a wiki page
// reference (e.g. `https://example.com`) so the caller can fall
// back to title-based slugification.
export function extractSlugFromBulletHref(rawHref: string): string {
  const href = rawHref.trim();
  if (!href) return "";
  if (/^[a-z]+:\/\//i.test(href)) return "";
  const lastSegment = href.split("/").pop() ?? href;
  return lastSegment.replace(/\.md$/i, "");
}

function parseBulletLinkRow(trimmed: string): WikiPageEntry | null {
  const match = BULLET_LINK_PATTERN.exec(trimmed);
  if (!match) return null;
  const title = match[1].trim();
  const href = match[2] ?? "";
  const raw = match[3]?.trim() ?? "";
  const { description, tags } = extractHashTags(raw);
  // Prefer the slug embedded in the href so non-ASCII titles keep
  // a navigable slug. Fall back to slugifying the title only when
  // the href has no recognisable slug (rare — usually means the
  // author put an external URL here).
  const slug = extractSlugFromBulletHref(href) || wikiSlugify(title);
  return { title, slug, description, tags };
}

function parseBulletWikiLinkRow(trimmed: string): WikiPageEntry | null {
  const match = BULLET_WIKI_LINK_PATTERN.exec(trimmed);
  if (!match) return null;
  const title = match[1].trim();
  const raw = match[2]?.trim() ?? "";
  const { description, tags } = extractHashTags(raw);
  return { title, slug: wikiSlugify(title), description, tags };
}

// Parse entries from index.md — supports three formats:
// 1. Table: | `slug` | Title | Summary | Date |
// 2. Bullet link: - [Title](pages/slug.md) — description
// 3. Wiki link: - [[Title]] — description
export function parseIndexEntries(content: string): WikiPageEntry[] {
  const entries: WikiPageEntry[] = [];
  let inTable = false;
  let columnMap: Map<string, number> | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("|")) {
      if (TABLE_SEPARATOR_PATTERN.test(trimmed)) {
        inTable = true;
        continue;
      }
      if (!inTable) {
        // First `|`-line before the separator is the header. Capture
        // the column map so parseTableRow can locate the Tags
        // column (if any) by name rather than position.
        columnMap = buildTableColumnMap(trimmed);
        inTable = true;
        continue;
      }
      const entry = parseTableRow(trimmed, columnMap);
      if (entry) entries.push(entry);
      continue;
    }

    inTable = false;
    columnMap = null;

    const bullet = parseBulletLinkRow(trimmed) ?? parseBulletWikiLinkRow(trimmed);
    if (bullet) entries.push(bullet);
  }
  return entries;
}

// Resolve a page name to an absolute `.md` path using the in-memory
// page index (see ./wiki/pageIndex.ts). Index is kept fresh via
// pagesDir mtime, so zero readdir cost on cache hit.
async function resolvePagePath(pageName: string): Promise<string | null> {
  const dir = pagesDir();
  const { slugs } = await getPageIndex(dir);
  if (slugs.size === 0) return null;

  const slug = wikiSlugify(pageName);

  if (slug.length > 0) {
    const exact = slugs.get(slug);
    if (exact) return path.join(dir, exact);

    // Fuzzy: same `includes` semantics as the old sync path — iterate
    // the index's keys, no filesystem access.
    for (const [key, file] of slugs) {
      if (slug.includes(key) || key.includes(slug)) {
        return path.join(dir, file);
      }
    }
  }

  // Non-ASCII page names (e.g. Japanese [[wiki links]]) produce empty
  // slugs after slugification. Fall back to matching by title in the
  // wiki index so the link resolves to its page file.
  const indexContent = readFileOrEmpty(indexFile());
  const entries = parseIndexEntries(indexContent);
  const titleMatch = entries.find((entry) => entry.title === pageName);
  if (titleMatch) {
    const file = slugs.get(titleMatch.slug);
    if (file) return path.join(dir, file);
  }

  return null;
}

router.get(API_ROUTES.wiki.base, async (req: Request, res: Response<WikiResponse | ErrorResponse>) => {
  const slug = getOptionalStringQuery(req, "slug");
  if (slug) {
    log.info("wiki", "GET page: start", { slugPreview: previewSnippet(slug) });
    try {
      const response = await buildPageResponse("page", slug);
      if (!response.data.pageExists) {
        log.warn("wiki", "GET page: not found", { slugPreview: previewSnippet(slug) });
      } else {
        log.info("wiki", "GET page: ok", { slugPreview: previewSnippet(slug), bytes: response.data.content.length });
      }
      res.json(response);
    } catch (err) {
      log.error("wiki", "GET page: threw", { slugPreview: previewSnippet(slug), error: formatError(err) });
      throw err;
    }
    return;
  }
  log.info("wiki", "GET index: start");
  const content = readFileOrEmpty(indexFile());
  const pageEntries = parseIndexEntries(content);
  log.info("wiki", "GET index: ok", { pages: pageEntries.length, bytes: content.length });
  res.json({
    data: { action: "index", title: "Wiki Index", content, pageEntries },
    message: content ? `Wiki index — ${pageEntries.length} page(s)` : "Wiki index is empty.",
    title: "Wiki Index",
    instructions: "The wiki index is now displayed on the canvas.",
    updating: true,
  });
});

interface WikiBody {
  action: string;
  pageName?: string;
  // `save` action only: full new file contents (frontmatter + body).
  content?: string;
}

interface WikiData {
  action: string;
  title: string;
  content: string;
  pageEntries?: WikiPageEntry[];
  pageName?: string;
  pageExists?: boolean;
  error?: string;
}

interface WikiResponse {
  data: WikiData;
  message: string;
  title: string;
  instructions: string;
  updating: boolean;
}

interface ErrorResponse {
  error: string;
}

function buildIndexResponse(action: string): WikiResponse {
  const content = readFileOrEmpty(indexFile());
  const pageEntries = parseIndexEntries(content);
  return {
    data: { action, title: "Wiki Index", content, pageEntries },
    message: content ? `Wiki index — ${pageEntries.length} page(s)` : "Wiki index is empty.",
    title: "Wiki Index",
    instructions: "The wiki index is now displayed on the canvas.",
    updating: true,
  };
}

// Pure branching helper extracted from buildPageResponse so the three
// states (missing / empty / has-content) can be pinned by unit tests
// without requiring a real filesystem. The I/O wrapper below supplies
// `exists`, `content`, and `resolvedTitle` from disk; this function
// builds the response shape — including the error / message /
// instructions distinctions that the GET and POST handlers share.
export function buildPageResponseData(args: { action: string; pageName: string; resolvedTitle: string; content: string; exists: boolean }): WikiResponse {
  const { action, pageName, resolvedTitle, content, exists } = args;
  const hasContent = Boolean(content);
  // Three states:
  //   1. !exists              → page file is missing entirely.
  //   2. exists && !hasContent → page file exists but is empty (e.g.,
  //                              zero-byte placeholder waiting to be filled).
  //   3. exists && hasContent  → normal page with body text.
  // Previously every "no content" case collapsed into "Page not found",
  // which mis-reported empty-but-existing pages. error / message /
  // instructions now distinguish missing vs empty so the client and
  // the agent get consistent signals.
  const missing = !exists;
  const slug = wikiSlugify(pageName);
  const errorMessage = missing ? `Page not found: ${pageName}` : hasContent ? undefined : `Page is empty: ${pageName}`;
  const statusMessage = hasContent ? `Showing page: ${resolvedTitle}` : missing ? `Page not found: ${pageName}` : `Page exists but is empty: ${resolvedTitle}`;
  const statusInstructions = hasContent
    ? "The wiki page is now displayed on the canvas."
    : missing
      ? `Page not found: wiki/pages/${slug}.md does not exist. You can create it or check the slug in wiki/index.md.`
      : `Page exists but is empty: wiki/pages/${slug}.md has no content yet. Research the topic and write a comprehensive article, then save it to the same path.`;
  return {
    data: {
      action,
      title: resolvedTitle,
      content,
      pageName: resolvedTitle,
      pageExists: exists,
      error: errorMessage,
    },
    message: statusMessage,
    title: resolvedTitle,
    instructions: statusInstructions,
    updating: true,
  };
}

// Pure-ish seam between `resolvePagePath` + `readFileOrEmpty` (the
// filesystem I/O) and `buildPageResponseData` (the response shape).
// Exported so tests can exercise the `exists`/`resolvedTitle`
// computation without spinning up a real wiki directory — the
// original regression this PR fixed was precisely this layer
// conflating `content` with `exists`, so pinning it here is worth
// the extra indirection.
export function toPageResponse(args: { action: string; pageName: string; filePath: string | null; content: string }): WikiResponse {
  const { action, pageName, filePath, content } = args;
  const resolvedTitle = filePath ? path.basename(filePath, ".md") : pageName;
  return buildPageResponseData({
    action,
    pageName,
    resolvedTitle,
    content,
    exists: Boolean(filePath),
  });
}

async function buildPageResponse(action: string, pageName: string): Promise<WikiResponse> {
  const filePath = await resolvePagePath(pageName);
  const content = filePath ? readFileOrEmpty(filePath) : "";
  return toPageResponse({ action, pageName, filePath, content });
}

function buildLogResponse(action: string): WikiResponse {
  const content = readFileOrEmpty(logFile());
  return {
    data: { action, title: "Activity Log", content },
    message: content ? "Wiki activity log" : "Activity log is empty.",
    title: "Activity Log",
    instructions: "The wiki activity log is now displayed on the canvas.",
    updating: true,
  };
}

const WIKI_LINK_PATTERN = /\[\[([^\][\r\n]{1,200})\]\]/g;

// Pure helpers extracted from the lint pass — they take what they
// need as plain inputs so each rule can be unit-tested without
// touching the filesystem.

export function findOrphanPages(fileSlugs: ReadonlySet<string>, indexedSlugs: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  for (const slug of fileSlugs) {
    if (!indexedSlugs.has(slug)) {
      issues.push(`- **Orphan page**: \`${slug}.md\` exists but is missing from index.md`);
    }
  }
  return issues;
}

export function findMissingFiles(pageEntries: readonly WikiPageEntry[], fileSlugs: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  for (const entry of pageEntries) {
    if (!fileSlugs.has(entry.slug)) {
      issues.push(`- **Missing file**: index.md references \`${entry.slug}\` but the file does not exist`);
    }
  }
  return issues;
}

export function findBrokenLinksInPage(fileName: string, content: string, fileSlugs: ReadonlySet<string>): string[] {
  const issues: string[] = [];
  const wikiLinks = [...content.matchAll(WIKI_LINK_PATTERN)].map((match) => match[1]);
  for (const link of wikiLinks) {
    const linkSlug = wikiSlugify(link);
    if (!fileSlugs.has(linkSlug)) {
      issues.push(`- **Broken link** in \`${fileName}\`: [[${link}]] → \`${linkSlug}.md\` not found`);
    }
  }
  return issues;
}

function formatTagList(tags: readonly string[]): string {
  return `[${[...tags].sort().join(", ")}]`;
}

// Flag any slug whose index.md tags differ from the page's own
// frontmatter `tags:` field. Comparison is set-based and order-
// insensitive; both sides are lowercased at parse time. Slugs
// missing from `frontmatterTagsBySlug` are ignored here — the
// missing file itself is already reported by `findMissingFiles`.
export function findTagDrift(pageEntries: readonly WikiPageEntry[], frontmatterTagsBySlug: ReadonlyMap<string, readonly string[]>): string[] {
  const issues: string[] = [];
  for (const entry of pageEntries) {
    // Lowercase on lookup — `collectLintIssues` keys the map with
    // lowercased slugs, so a `MyPage.md` filename still matches an
    // `entry.slug` of `mypage` produced by `wikiSlugify` on the
    // wiki-link parser path.
    const pageTags = frontmatterTagsBySlug.get(entry.slug.toLowerCase());
    if (pageTags === undefined) continue;
    const pageSet = new Set(pageTags);
    const indexSet = new Set(entry.tags);
    if (pageSet.size !== indexSet.size || [...pageSet].some((tag) => !indexSet.has(tag))) {
      issues.push(`- **Tag drift**: \`${entry.slug}.md\` frontmatter has ${formatTagList(pageTags)} but index.md has ${formatTagList(entry.tags)}`);
    }
  }
  return issues;
}

export function formatLintReport(issues: readonly string[]): string {
  if (issues.length === 0) {
    return "# Wiki Lint Report\n\n✓ No issues found. Wiki is healthy.";
  }
  const noun = `issue${issues.length !== 1 ? "s" : ""}`;
  return `# Wiki Lint Report\n\n${issues.length} ${noun} found:\n\n${issues.join("\n")}`;
}

async function collectLintIssues(): Promise<string[]> {
  const dir = pagesDir();
  const { slugs } = await getPageIndex(dir);
  if (slugs.size === 0) {
    return ["- Wiki `pages/` directory does not exist yet. Start ingesting sources."];
  }
  const indexContent = readFileOrEmpty(indexFile());
  const pageEntries = parseIndexEntries(indexContent);
  const indexedSlugs = new Set(pageEntries.map((entry) => entry.slug));
  const pageFiles = [...slugs.values()];
  const fileSlugs = new Set(slugs.keys());

  const issues: string[] = [];
  issues.push(...findOrphanPages(fileSlugs, indexedSlugs));
  issues.push(...findMissingFiles(pageEntries, fileSlugs));
  // Parallel read: N small markdown files, ~50 KB each. Bounded by
  // the number of wiki pages, not by CPU.
  const contents = await Promise.all(
    pageFiles.map(async (fileName) => {
      const content = await readTextSafe(path.join(dir, fileName));
      return content ?? "";
    }),
  );
  const frontmatterTagsBySlug = new Map<string, string[]>();
  for (let i = 0; i < pageFiles.length; i++) {
    issues.push(...findBrokenLinksInPage(pageFiles[i], contents[i], fileSlugs));
    // Lowercase the map key so a `MyPage.md` filename still matches
    // an `entry.slug` of `mypage` produced by `wikiSlugify` on the
    // wiki-link parser path. `findTagDrift` lowercases the lookup
    // side to match.
    const slug = pageFiles[i].replace(/\.md$/i, "").toLowerCase();
    frontmatterTagsBySlug.set(slug, parseFrontmatterTags(contents[i]));
  }
  issues.push(...findTagDrift(pageEntries, frontmatterTagsBySlug));
  return issues;
}

// Result of a save attempt — null on lookup miss so the route can
// return 404 distinctly from a 400 / 500.
type SaveOutcome = { ok: true; absPath: string } | { ok: false; reason: "not-found" };

async function saveExistingPage(pageName: string, content: string): Promise<SaveOutcome> {
  const absPath = await resolvePagePath(pageName);
  if (!absPath) return { ok: false, reason: "not-found" };
  // Funnel through the wiki-page write helper. Atomic write is
  // guaranteed inside; the helper also routes the (old, new) pair
  // to the snapshot pipeline (#763 PR 2 — currently a no-op stub).
  // Editor identity defaults to "user" here because the route is
  // hit by both LLM (`manageWiki` MCP) and frontend saves; PR 2
  // disambiguates them via a request-side flag.
  const slug = path.basename(absPath, ".md");
  await writeWikiPage(slug, content, { editor: "user" });
  return { ok: true, absPath };
}

// Extracted from the POST switch to keep the route handler under
// the project's cognitive-complexity limit. Returns true if the
// response was sent (success or any handled error), false to fall
// through to the next case (currently unused — every code path
// terminates).
async function handleSaveAction(
  req: Request<object, unknown, WikiBody>,
  res: Response<WikiResponse | ErrorResponse>,
  pageName: string | undefined,
): Promise<void> {
  if (!pageName) {
    log.warn("wiki", "POST save: missing pageName");
    badRequest(res, "pageName required for save action");
    return;
  }
  const { content } = req.body;
  if (typeof content !== "string") {
    log.warn("wiki", "POST save: missing content", { pageNamePreview: previewSnippet(pageName) });
    badRequest(res, "content (string) required for save action");
    return;
  }
  const outcome = await saveExistingPage(pageName, content);
  if (!outcome.ok) {
    log.warn("wiki", "POST save: page not found", { pageNamePreview: previewSnippet(pageName) });
    notFound(res, `Page not found: ${pageName}`);
    return;
  }
  log.info("wiki", "POST save: ok", { pageNamePreview: previewSnippet(pageName), bytes: content.length });
  // Re-read so the response carries the canonical post-write state.
  const response = await buildPageResponse("page", pageName);
  res.json(response);
}

async function buildLintReportResponse(action: string): Promise<WikiResponse> {
  const issues = await collectLintIssues();
  const report = formatLintReport(issues);
  const healthy = issues.length === 0;
  return {
    data: { action, title: "Wiki Lint Report", content: report },
    message: healthy ? "Wiki is healthy" : `${issues.length} issue(s) found`,
    title: "Wiki Lint Report",
    instructions: healthy ? "Wiki is healthy — no issues found." : `${issues.length} issue(s) found that need fixing:\n${issues.join("\n")}`,
    updating: true,
  };
}

router.post(API_ROUTES.wiki.base, async (req: Request<object, unknown, WikiBody>, res: Response<WikiResponse | ErrorResponse>) => {
  const { action, pageName } = req.body;
  log.info("wiki", "POST: start", { action, pageNamePreview: pageName ? previewSnippet(pageName) : undefined });
  try {
    switch (action) {
      case "index": {
        const response = buildIndexResponse(action);
        log.info("wiki", "POST index: ok", { pages: response.data.pageEntries?.length ?? 0 });
        res.json(response);
        return;
      }
      case "page": {
        if (!pageName) {
          log.warn("wiki", "POST page: missing pageName");
          badRequest(res, "pageName required for page action");
          return;
        }
        const response = await buildPageResponse(action, pageName);
        if (!response.data.pageExists) {
          log.warn("wiki", "POST page: not found", { pageNamePreview: previewSnippet(pageName) });
        } else {
          log.info("wiki", "POST page: ok", { pageNamePreview: previewSnippet(pageName), bytes: response.data.content.length });
        }
        res.json(response);
        return;
      }
      case "log": {
        const response = buildLogResponse(action);
        log.info("wiki", "POST log: ok", { bytes: response.data.content.length });
        res.json(response);
        return;
      }
      case "lint_report": {
        const response = await buildLintReportResponse(action);
        // `summary` not `issues`: the field is the human-readable
        // result string ("Wiki is healthy" / "N issue(s) found"),
        // not a count. Aggregators that group by `issues` would
        // otherwise treat the same string as a numeric facet.
        log.info("wiki", "POST lint_report: ok", { summary: response.message });
        res.json(response);
        return;
      }
      case "save": {
        // Used by the wiki page View when the user toggles a GFM
        // task checkbox in the rendered body (#775). Overwrites the
        // existing page file atomically; refuses to create new pages
        // — that flow lives elsewhere (LLM via Write, manageWiki).
        await handleSaveAction(req, res, pageName);
        return;
      }
      default:
        log.warn("wiki", "POST: unknown action", { action });
        badRequest(res, `Unknown action: ${action}`);
    }
  } catch (err) {
    log.error("wiki", "POST: threw", { action, pageNamePreview: pageName ? previewSnippet(pageName) : undefined, error: formatError(err) });
    throw err;
  }
});

export default router;
