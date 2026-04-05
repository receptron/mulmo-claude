import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { workspacePath } from "../workspace.js";

const router = Router();

const wikiDir = () => path.join(workspacePath, "wiki");
const pagesDir = () => path.join(wikiDir(), "pages");
const indexFile = () => path.join(wikiDir(), "index.md");
const logFile = () => path.join(wikiDir(), "log.md");

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  } catch {
    return "";
  }
}

export interface WikiPageEntry {
  title: string;
  slug: string;
  description: string;
}

// Parse entries from index.md — supports three formats:
// 1. Table: | `slug` | Title | Summary | Date |
// 2. Bullet link: - [Title](pages/slug.md) — description
// 3. Wiki link: - [[Title]] — description
function parseIndexEntries(content: string): WikiPageEntry[] {
  const entries: WikiPageEntry[] = [];
  let inTable = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Table rows: | cell | cell | ... |
    if (trimmed.startsWith("|")) {
      // Skip header separator rows like |---|---|
      if (/^\|[\s|:-]+\|$/.test(trimmed)) {
        inTable = true;
        continue;
      }
      if (!inTable) {
        inTable = true;
        continue; // skip header row
      }
      const cols = trimmed
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim().replace(/^`|`$/g, ""));
      if (cols.length >= 2) {
        const slug = cols[0];
        const title = cols[1] || slug;
        const desc = cols[2] ?? "";
        if (slug && title) entries.push({ title, slug, description: desc });
      }
      continue;
    }

    inTable = false;

    // Bullet with markdown link: - [Title](path) — desc
    const linkMatch = trimmed.match(
      /^[-*]\s+\[([^\]]+)\]\([^)]*\)(?:\s*[—–-]\s*(.*))?/,
    );
    if (linkMatch) {
      const title = linkMatch[1].trim();
      const desc = linkMatch[2]?.trim() ?? "";
      const slug = title
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      entries.push({ title, slug, description: desc });
      continue;
    }

    // Bullet with wiki link: - [[Title]] — desc
    const wikiMatch = trimmed.match(
      /^[-*]\s+\[\[([^\]]+)\]\](?:\s*[—–-]\s*(.*))?/,
    );
    if (wikiMatch) {
      const title = wikiMatch[1].trim();
      const desc = wikiMatch[2]?.trim() ?? "";
      const slug = title
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      entries.push({ title, slug, description: desc });
    }
  }
  return entries;
}

function resolvePagePath(pageName: string): string | null {
  const dir = pagesDir();
  if (!fs.existsSync(dir)) return null;

  const slug = pageName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const exact = path.join(dir, `${slug}.md`);
  if (fs.existsSync(exact)) return exact;

  // Fuzzy: find a file that contains the slug or vice versa
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const match = files.find((f) => {
    const base = f.replace(".md", "");
    return base.includes(slug) || slug.includes(base);
  });
  return match ? path.join(dir, match) : null;
}

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

router.post(
  "/wiki",
  (
    req: Request<object, unknown, WikiBody>,
    res: Response<WikiResponse | ErrorResponse>,
  ) => {
    const { action, pageName } = req.body;

    switch (action) {
      case "index": {
        const content = readFileOrEmpty(indexFile());
        const pageEntries = parseIndexEntries(content);
        res.json({
          data: { action, title: "Wiki Index", content, pageEntries },
          message: content
            ? `Wiki index — ${pageEntries.length} page(s)`
            : "Wiki index is empty.",
          title: "Wiki Index",
          instructions: "The wiki index is now displayed on the canvas.",
          updating: true,
        });
        return;
      }

      case "page": {
        if (!pageName) {
          res.status(400).json({ error: "pageName required for page action" });
          return;
        }
        const filePath = resolvePagePath(pageName);
        const content = filePath ? readFileOrEmpty(filePath) : "";
        const resolvedTitle = filePath
          ? path.basename(filePath, ".md")
          : pageName;
        const found = !!content;
        res.json({
          data: {
            action,
            title: resolvedTitle,
            content,
            pageName: resolvedTitle,
            error: found ? undefined : `Page not found: ${pageName}`,
          },
          message: found
            ? `Showing page: ${resolvedTitle}`
            : `Page not found: ${pageName}`,
          title: resolvedTitle,
          instructions: found
            ? "The wiki page is now displayed on the canvas."
            : `Page not found: wiki/pages/${pageName
                .toLowerCase()
                .replace(/\s+/g, "-")
                .replace(
                  /[^a-z0-9-]/g,
                  "",
                )}.md does not exist. You can create it or check the slug in wiki/index.md.`,
          updating: true,
        });
        return;
      }

      case "log": {
        const content = readFileOrEmpty(logFile());
        res.json({
          data: { action, title: "Activity Log", content },
          message: content ? "Wiki activity log" : "Activity log is empty.",
          title: "Activity Log",
          instructions: "The wiki activity log is now displayed on the canvas.",
          updating: true,
        });
        return;
      }

      case "lint_report": {
        const dir = pagesDir();
        const indexContent = readFileOrEmpty(indexFile());
        const pageEntries = parseIndexEntries(indexContent);
        const indexedSlugs = new Set(pageEntries.map((e) => e.slug));
        const issues: string[] = [];

        if (fs.existsSync(dir)) {
          const pageFiles = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".md"));
          const fileSlugs = new Set(pageFiles.map((f) => f.replace(".md", "")));

          for (const slug of fileSlugs) {
            if (!indexedSlugs.has(slug)) {
              issues.push(
                `- **Orphan page**: \`${slug}.md\` exists but is missing from index.md`,
              );
            }
          }

          for (const entry of pageEntries) {
            if (!fileSlugs.has(entry.slug)) {
              issues.push(
                `- **Missing file**: index.md references \`${entry.slug}\` but the file does not exist`,
              );
            }
          }

          for (const file of pageFiles) {
            const content = readFileOrEmpty(path.join(dir, file));
            const wikiLinks = [
              ...content.matchAll(/\[\[([^\][\r\n]{1,200})\]\]/g),
            ].map((m) => m[1]);
            for (const link of wikiLinks) {
              const linkSlug = link
                .toLowerCase()
                .replace(/\s+/g, "-")
                .replace(/[^a-z0-9-]/g, "");
              if (!fileSlugs.has(linkSlug)) {
                issues.push(
                  `- **Broken link** in \`${file}\`: [[${link}]] → \`${linkSlug}.md\` not found`,
                );
              }
            }
          }
        } else {
          issues.push(
            "- Wiki `pages/` directory does not exist yet. Start ingesting sources.",
          );
        }

        const report =
          issues.length === 0
            ? "# Wiki Lint Report\n\n✓ No issues found. Wiki is healthy."
            : `# Wiki Lint Report\n\n${issues.length} issue${issues.length !== 1 ? "s" : ""} found:\n\n${issues.join("\n")}`;

        res.json({
          data: { action, title: "Wiki Lint Report", content: report },
          message:
            issues.length === 0
              ? "Wiki is healthy"
              : `${issues.length} issue(s) found`,
          title: "Wiki Lint Report",
          instructions:
            issues.length === 0
              ? "Wiki is healthy — no issues found."
              : `${issues.length} issue(s) found that need fixing:\n${issues.join("\n")}`,
          updating: true,
        });
        return;
      }

      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
    }
  },
);

export default router;
