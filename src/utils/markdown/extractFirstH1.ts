// Extract the first ATX-style H1 heading (`# title`) from a
// markdown string. Used by both:
//   - server/journal/index.ts (topic row labels)
//   - src/plugins/markdown/Preview.vue (document title)
//
// Implemented as a line walker rather than a regex so it avoids
// the backtracking risk that trips `sonarjs/slow-regex`. The
// accepted heading grammar matches the plugin's old regex
// `/^#\s+(.+)$/m`: `#`, at least one inline whitespace char, then
// non-empty content.

/**
 * Return the trimmed text of the first H1 line, or null if none
 * exists. An H1 is a line that starts with `#` followed by at
 * least one whitespace char (space or tab) and at least one
 * non-whitespace content char. `##` and deeper headings are
 * skipped. Lines are separated by `\n`, `\r`, or `\r\n` —
 * mirroring the old regex's `m`-flag `$` anchor which stops at
 * either CR or LF.
 */
export function extractFirstH1(markdown: string): string | null {
  for (const line of splitLines(markdown)) {
    if (line.length < 2 || line[0] !== "#") continue;
    // Second char must be inline whitespace, not another `#`.
    // That's what excludes `## H2` / `### H3` / etc.
    if (!isInlineSpace(line.charCodeAt(1))) continue;
    const text = line.slice(2).trim();
    if (text.length > 0) return text;
  }
  return null;
}

function splitLines(s: string): string[] {
  return s.split(/\r\n|\r|\n/);
}

function isInlineSpace(code: number): boolean {
  return code === 0x20 || code === 0x09; // space or tab
}
