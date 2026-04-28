// Central audit point for server-side regular expressions.
//
// Why one file? `eslint-plugin-security`'s `detect-unsafe-regex` rule
// fires on any regex with a non-trivial nested-quantifier shape, even
// when surrounding analysis shows the pattern is bounded. Rather than
// scatter `eslint-disable-next-line` annotations across the server
// tree, every server regex that the rule flagged lives here with its
// ReDoS-safety rationale spelled out — security reviews start at this
// file.
//
// Browser-side regexes (`src/utils/format/jsonSyntax.ts`,
// `src/utils/markdown/taskList.ts`) stay in their consumer files
// because moving them would force the frontend to import from
// `server/`. A symmetric `src/utils/regex.ts` could be added later;
// kept out of scope here so this file has only one architectural
// layer.

// ── Slug validator ────────────────────────────────────────────────
//
// Used by `server/utils/slug.ts#isValidSlug` and (transitively)
// every domain that slugifies user input — todos, wiki, sources,
// skills. Linear in input length; `[a-z0-9-]*` and `[a-z0-9]` don't
// share characters with each other or with the boundary `^` / `$`,
// so the optional capture group can't drive backtracking. Caller
// length-caps input at `DEFAULT_MAX_LENGTH` (120 chars) BEFORE
// invoking the regex, so worst-case is ~120 character comparisons.
//
// eslint-disable-next-line security/detect-unsafe-regex -- bounded slug validator (length-capped by caller; no nested-quantifier overlap)
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// ── Wiki bullet-link parsers ──────────────────────────────────────
//
// Used by `server/api/routes/wiki.ts` to parse top-of-page index
// bullets like:
//   - [Title](path/to/page.md) — optional summary
//   - [[wiki-style title]] — optional summary
// Each `[^x]+` runs over a fixed exclusion set with a hard delimiter
// (`]`, `)`); the optional summary group's `(.*)` is a single greedy
// run, no nested overlap. Linear in line length.
//
// eslint-disable-next-line security/detect-unsafe-regex -- bullet-link parser; bounded captures with hard delimiters
export const BULLET_LINK_PATTERN = /^[-*]\s+\[([^\]]+)\]\(([^)]*)\)(?:\s*[—–-]\s*(.*))?/;
// eslint-disable-next-line security/detect-unsafe-regex -- same shape as BULLET_LINK_PATTERN
export const BULLET_WIKI_LINK_PATTERN = /^[-*]\s+\[\[([^\]]+)\]\](?:\s*[—–-]\s*(.*))?/;

// ── Skills body blank-line stripper ───────────────────────────────
//
// Used by `server/workspace/skills/parser.ts` to drop leading blank
// lines from a skill's body after stripping the frontmatter. `\s*\n`
// consumes one line at a time with optional leading whitespace; the
// outer `+` repeats over distinct lines (each iteration MUST consume
// at least the trailing `\n`), so no overlap → linear in input
// length.
//
// eslint-disable-next-line security/detect-unsafe-regex -- linear blank-line stripper, no nested-quantifier overlap
export const LEADING_BLANK_LINES_PATTERN = /^(?:\s*\n)+/;
