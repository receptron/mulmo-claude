import { Router, Request, Response } from "express";
import path from "path";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { readTextSafeSync, readTextSafe } from "../../utils/files/safe.js";
import { getPageIndex } from "./wiki/pageIndex.js";
import { badRequest } from "../../utils/httpError.js";
import { API_ROUTES } from "../../../src/config/apiRoutes.js";

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
// Capture the href (group 2) alongside the title (group 1) so we can
// derive the slug from the file name instead of re-slugifying the
// title. This matters for non-ASCII titles like "さくらインターネット"
// where `wikiSlugify` returns "" and the slug would otherwise be lost.
const BULLET_LINK_PATTERN = /^[-*]\s+\[([^\]]+)\]\(([^)]*)\)(?:\s*[—–-]\s*(.*))?/;
const BULLET_WIKI_LINK_PATTERN = /^[-*]\s+\[\[([^\]]+)\]\](?:\s*[—–-]\s*(.*))?/;

// Each parser returns the entry it produced (if any). The parent
// loop tries them in order; the first non-null result wins.
function parseTableRow(trimmed: string): WikiPageEntry | null {
  const cols = trimmed
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim().replace(/^`|`$/g, ""));
  if (cols.length < 2) return null;
  const slug = cols[0];
  const title = cols[1] || slug;
  const desc = cols[2] ?? "";
  if (!slug || !title) return null;
  return { title, slug, description: desc };
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
  const m = BULLET_LINK_PATTERN.exec(trimmed);
  if (!m) return null;
  const title = m[1].trim();
  const href = m[2] ?? "";
  const desc = m[3]?.trim() ?? "";
  // Prefer the slug embedded in the href so non-ASCII titles keep
  // a navigable slug. Fall back to slugifying the title only when
  // the href has no recognisable slug (rare — usually means the
  // author put an external URL here).
  const slug = extractSlugFromBulletHref(href) || wikiSlugify(title);
  return { title, slug, description: desc };
}

function parseBulletWikiLinkRow(trimmed: string): WikiPageEntry | null {
  const m = BULLET_WIKI_LINK_PATTERN.exec(trimmed);
  if (!m) return null;
  const title = m[1].trim();
  const desc = m[2]?.trim() ?? "";
  return { title, slug: wikiSlugify(title), description: desc };
}

// Parse entries from index.md — supports three formats:
// 1. Table: | `slug` | Title | Summary | Date |
// 2. Bullet link: - [Title](pages/slug.md) — description
// 3. Wiki link: - [[Title]] — description
export function parseIndexEntries(content: string): WikiPageEntry[] {
  const entries: WikiPageEntry[] = [];
  let inTable = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("|")) {
      // Header / separator rows just toggle the in-table flag and
      // produce no entry.
      if (TABLE_SEPARATOR_PATTERN.test(trimmed) || !inTable) {
        inTable = true;
        continue;
      }
      const entry = parseTableRow(trimmed);
      if (entry) entries.push(entry);
      continue;
    }

    inTable = false;

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

  const exact = slugs.get(slug);
  if (exact) return path.join(dir, exact);

  // Fuzzy: same `includes` semantics as the old sync path — iterate
  // the index's keys, no filesystem access.
  for (const [key, file] of slugs) {
    if (slug.includes(key) || key.includes(slug)) {
      return path.join(dir, file);
    }
  }
  return null;
}

router.get(API_ROUTES.wiki.base, async (req: Request, res: Response<WikiResponse | ErrorResponse>) => {
  const slug = typeof req.query.slug === "string" ? req.query.slug : undefined;
  if (slug) {
    const filePath = await resolvePagePath(slug);
    const content = filePath ? readFileOrEmpty(filePath) : "";
    const resolvedTitle = filePath ? path.basename(filePath, ".md") : slug;
    res.json({
      data: {
        action: "page",
        title: resolvedTitle,
        content,
        pageName: resolvedTitle,
        error: content ? undefined : `Page not found: ${slug}`,
      },
      message: content ? `Showing page: ${resolvedTitle}` : `Page not found: ${slug}`,
      title: resolvedTitle,
      instructions: "The wiki page is now displayed on the canvas.",
      updating: true,
    });
  } else {
    const content = readFileOrEmpty(indexFile());
    const pageEntries = parseIndexEntries(content);
    res.json({
      data: { action: "index", title: "Wiki Index", content, pageEntries },
      message: content ? `Wiki index — ${pageEntries.length} page(s)` : "Wiki index is empty.",
      title: "Wiki Index",
      instructions: "The wiki index is now displayed on the canvas.",
      updating: true,
    });
  }
});

interface WikiBody {
  action: string;
  pageName?: string;
}

interface WikiData {
  action: string;
  title: string;
  content: string;
  pageEntries?: WikiPageEntry[];
  pageName?: string;
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

async function buildPageResponse(action: string, pageName: string): Promise<WikiResponse> {
  const filePath = await resolvePagePath(pageName);
  const content = filePath ? readFileOrEmpty(filePath) : "";
  const resolvedTitle = filePath ? path.basename(filePath, ".md") : pageName;
  const found = !!content;
  return {
    data: {
      action,
      title: resolvedTitle,
      content,
      pageName: resolvedTitle,
      error: found ? undefined : `Page not found: ${pageName}`,
    },
    message: found ? `Showing page: ${resolvedTitle}` : `Page not found: ${pageName}`,
    title: resolvedTitle,
    instructions: found
      ? "The wiki page is now displayed on the canvas."
      : `Page not found: wiki/pages/${wikiSlugify(pageName)}.md does not exist. You can create it or check the slug in wiki/index.md.`,
    updating: true,
  };
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
  const wikiLinks = [...content.matchAll(WIKI_LINK_PATTERN)].map((m) => m[1]);
  for (const link of wikiLinks) {
    const linkSlug = wikiSlugify(link);
    if (!fileSlugs.has(linkSlug)) {
      issues.push(`- **Broken link** in \`${fileName}\`: [[${link}]] → \`${linkSlug}.md\` not found`);
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
  const indexedSlugs = new Set(pageEntries.map((e) => e.slug));
  const pageFiles = [...slugs.values()];
  const fileSlugs = new Set(slugs.keys());

  const issues: string[] = [];
  issues.push(...findOrphanPages(fileSlugs, indexedSlugs));
  issues.push(...findMissingFiles(pageEntries, fileSlugs));
  // Parallel read: N small markdown files, ~50 KB each. Bounded by
  // the number of wiki pages, not by CPU.
  const contents = await Promise.all(
    pageFiles.map(async (f) => {
      const content = await readTextSafe(path.join(dir, f));
      return content ?? "";
    }),
  );
  for (let i = 0; i < pageFiles.length; i++) {
    issues.push(...findBrokenLinksInPage(pageFiles[i], contents[i], fileSlugs));
  }
  return issues;
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
  switch (action) {
    case "index":
      res.json(buildIndexResponse(action));
      return;
    case "page":
      if (!pageName) {
        badRequest(res, "pageName required for page action");
        return;
      }
      res.json(await buildPageResponse(action, pageName));
      return;
    case "log":
      res.json(buildLogResponse(action));
      return;
    case "lint_report":
      res.json(await buildLintReportResponse(action));
      return;
    default:
      badRequest(res, `Unknown action: ${action}`);
  }
});

export default router;
