// Read-side frontmatter helpers for the wiki engine. The generic
// `---\n…\n---\n` envelope parsing is the canonical value-preserving
// (FAILSAFE_SCHEMA) parser in `@mulmoclaude/markdown-utils`; only the
// wiki-specific `tags:` reader stays here. Re-exporting `parseFrontmatter`
// keeps the `@mulmoclaude/core/wiki/server` barrel surface stable — it now
// returns the richer `{ meta, body, hasHeader }` shape.

import { parseFrontmatter } from "@mulmoclaude/markdown-utils/markdown/frontmatter";

export { parseFrontmatter };

function cleanTagToken(token: string): string {
  return token
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^#/, "")
    .toLowerCase();
}

/** Narrow `tags:` reader. Handles flow (`tags: [a, b]`) and block-list
 *  style; anything unparseable returns `[]` (best-effort, never throws). */
export function parseFrontmatterTags(content: string): string[] {
  const parsed = parseFrontmatter(content);
  if (!parsed.hasHeader) return [];
  const tagsValue = parsed.meta.tags;
  if (!Array.isArray(tagsValue)) return [];
  return tagsValue
    .filter((item): item is string => typeof item === "string")
    .map(cleanTagToken)
    .filter((token) => token.length > 0);
}
