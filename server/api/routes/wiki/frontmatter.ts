// Narrow YAML frontmatter reader for wiki page files. We only need
// the `tags:` field, so a tiny regex-based parser beats pulling in a
// full YAML dependency. Supports both flow style (`tags: [a, b, c]`)
// and block-list style:
//
//   tags:
//     - a
//     - b
//
// Anything unparseable returns `[]` — callers use this for a
// best-effort comparison against index.md, so a noisy file should
// degrade silently, not throw.

// Match `- value` with any leading indentation. Keeps to linear
// matching (no lazy quantifier) so sonarjs/slow-regex stays happy.
const BLOCK_LIST_ITEM_PATTERN = /^\s*-\s+(\S.*)$/;

// Pull the inner list from a line that starts with `tags:` and
// contains a `[...]` flow list. Returns null when the line isn't a
// flow-style tags line. Bracket matching is done with `indexOf` so
// we don't need a lazy-quantified regex.
function extractFlowTagsCell(line: string): string | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("tags:")) return null;
  const open = trimmed.indexOf("[");
  if (open === -1) return null;
  const close = trimmed.indexOf("]", open + 1);
  if (close === -1) return null;
  return trimmed.slice(open + 1, close);
}

// Extract the YAML frontmatter body with plain string scanning so
// we don't rely on a lazy-quantified regex (which ESLint's slow-regex
// rule flags for super-linear backtracking when the closing fence is
// missing). Returns null when no well-formed `---\n…\n---` block is
// present at the top of the file.
function extractFrontmatterBody(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const after = content.indexOf("\n");
  if (after === -1) return null;
  const close = content.indexOf("\n---", after);
  if (close === -1) return null;
  return content.slice(after + 1, close);
}

function cleanTagToken(token: string): string {
  return token
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/^#/, "")
    .toLowerCase();
}

function parseFlowList(cell: string): string[] {
  return cell
    .split(",")
    .map(cleanTagToken)
    .filter((token) => token.length > 0);
}

function parseBlockList(lines: string[], startIndex: number): string[] {
  const tags: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Block list ends at the first line that isn't a list item —
    // blank line, next key, or unindented text.
    if (/^\S/.test(line) || line.trim() === "") break;
    const match = BLOCK_LIST_ITEM_PATTERN.exec(line);
    if (!match) break;
    const token = cleanTagToken(match[1].trimEnd());
    if (token.length > 0) tags.push(token);
  }
  return tags;
}

export function parseFrontmatterTags(content: string): string[] {
  const body = extractFrontmatterBody(content);
  if (body === null) return [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const flow = extractFlowTagsCell(lines[i]);
    if (flow !== null) return parseFlowList(flow);
    if (/^tags:\s*$/.test(lines[i])) return parseBlockList(lines, i);
  }
  return [];
}
