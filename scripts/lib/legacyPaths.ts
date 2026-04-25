// Pure text rewriter for the #773 migration. Extracted from the CLI
// driver so the match/replace rules are unit-testable without any
// filesystem dependency.
//
// Legacy prefixes (#284 moved the directories but left in-file text
// references untouched):
//
//   markdowns/<name>.md      → artifacts/documents/<name>.md
//   spreadsheets/<name>.json → artifacts/spreadsheets/<name>.json
//
// Match constraints:
//   - Lookbehind `(?<![\w/.-])` prevents rewriting when the prefix is
//     a suffix of a longer token (e.g. `my-markdowns/`, `a/markdowns/`,
//     `foo.markdowns/`). Only boundary characters such as `"`, `(`,
//     `` ` ``, space, line-start are acceptable.
//   - Filename chars restricted to `[\w.-]+` so we don't eat past the
//     closing quote/paren/backtick.
//   - Suffix is required (`.md` / `.json`) to pin the match to actual
//     artifact file references — free-prose sentences mentioning
//     "markdowns" in other contexts are left alone.

const MARKDOWNS_RE = /(?<![\w/.\-])markdowns\/([\w.\-]+\.md)/g;
const SPREADSHEETS_RE = /(?<![\w/.\-])spreadsheets\/([\w.\-]+\.json)/g;

export interface RewriteResult {
  text: string;
  // Number of occurrences replaced across all legacy prefixes.
  occurrences: number;
}

export function rewriteLegacyPaths(input: string): RewriteResult {
  let occurrences = 0;
  const afterMarkdowns = input.replace(MARKDOWNS_RE, (_match, name) => {
    occurrences++;
    return `artifacts/documents/${name}`;
  });
  const afterSpreadsheets = afterMarkdowns.replace(SPREADSHEETS_RE, (_match, name) => {
    occurrences++;
    return `artifacts/spreadsheets/${name}`;
  });
  return { text: afterSpreadsheets, occurrences };
}

export function hasLegacyPaths(input: string): boolean {
  // Reset lastIndex for safety since the regexes are /g.
  MARKDOWNS_RE.lastIndex = 0;
  SPREADSHEETS_RE.lastIndex = 0;
  return MARKDOWNS_RE.test(input) || SPREADSHEETS_RE.test(input);
}
