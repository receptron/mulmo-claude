// Narrow `tags:` field reader for wiki page files. Built on the
// shared `parseFrontmatter` util (#895 PR C) — js-yaml handles
// both flow style (`tags: [a, b, c]`) and block-list style:
//
//   tags:
//     - a
//     - b
//
// out of the box, so we just normalise the resulting strings.
//
// Anything unparseable returns `[]` — callers use this for a
// best-effort comparison against index.md, so a noisy file should
// degrade silently, not throw.

import { parseFrontmatter } from "../../../utils/markdown/frontmatter.js";

function cleanTagToken(token: string): string {
  return token
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^#/, "")
    .toLowerCase();
}

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
