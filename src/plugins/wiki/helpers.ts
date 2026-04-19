// Pure helpers for wiki/View.vue. Replaces the former
// `/\[\[([^\]]+)\]\]/g` regex — flagged by `sonarjs/slow-regex`
// for backtracking risk — with a linear walker.

/**
 * Replace every `[[page name]]` occurrence in `content` with a
 * `<span class="wiki-link" data-page="…">…</span>` element. The
 * page name may not contain `]`; an opening `[[` that is not
 * followed later by `]]` (with no bare `]` in between) is left
 * untouched so malformed text renders as-is — matching the
 * previous regex's non-match behaviour.
 *
 * The page-name text is used both as the `data-page` attribute
 * value and as the span's visible text, identical to the old
 * replacement string `'<span class="wiki-link" data-page="$1">$1</span>'`.
 */
export function renderWikiLinks(content: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === "[" && content[i + 1] === "[") {
      const closeStart = findNextCloseBrackets(content, i + 2);
      if (closeStart !== -1) {
        const page = content.slice(i + 2, closeStart);
        out.push(`<span class="wiki-link" data-page="${page}">${page}</span>`);
        i = closeStart + 2;
        continue;
      }
    }
    out.push(content[i]);
    i++;
  }
  return out.join("");
}

/**
 * Starting at `from`, scan forward for a `]]` sequence. Returns
 * the index of the first `]` of that pair, or -1 if a bare `]`
 * (one not immediately followed by a second `]`) is encountered
 * first — mirroring the old regex's `[^\]]+` constraint that the
 * page name must contain no `]` characters. Also returns -1 if
 * nothing matched before the end of input, or if the pair sits
 * immediately after `from` (zero-length page name, which the old
 * regex rejected via the `+` quantifier).
 */
function findNextCloseBrackets(s: string, from: number): number {
  let j = from;
  while (j < s.length) {
    if (s[j] === "]") {
      if (s[j + 1] === "]" && j > from) return j;
      // Bare `]` inside the page-name span — old regex would not
      // match here, so we bail and let the caller emit the `[[`
      // as literal text.
      return -1;
    }
    j++;
  }
  return -1;
}
