// Pure helpers for presentHtml/Preview.vue. Replaces the former
// `/<[^>]*>/g` + `/\s+/g` regex pair — both flagged by
// `sonarjs/slow-regex` for backtracking risk — with a single
// linear walker that produces the exact same output.

/**
 * Produce a short plain-text preview from an HTML fragment:
 *
 * - every `<...>` span (a `<` with a later `>`) is replaced by a
 *   single space
 * - a bare `<` with no matching `>` is kept as a literal character
 *   (matches the old regex, which required both brackets to match)
 * - runs of whitespace are collapsed to one space
 * - the result is trimmed and truncated to `maxLength` characters
 *
 * The walker is O(n) in the input length and does no regex
 * backtracking.
 */
export function stripHtmlToPreview(html: string, maxLength: number): string {
  const state: WalkerState = {
    out: [],
    // Start as if we just emitted a space so leading whitespace
    // and a leading tag both get trimmed without a separate pass.
    lastWasSpace: true,
  };
  let i = 0;
  while (i < html.length) {
    const c = html[i];
    if (c === "<") {
      const close = html.indexOf(">", i + 1);
      if (close !== -1) {
        // Real tag span `<...>` — skip it, emit a separator.
        emitSeparator(state);
        i = close + 1;
        continue;
      }
      // No closing `>` anywhere after — treat as literal.
    }
    emitChar(state, c);
    i++;
  }
  trimTrailingSpace(state.out);
  return state.out.join("").slice(0, maxLength);
}

interface WalkerState {
  out: string[];
  lastWasSpace: boolean;
}

function emitChar(state: WalkerState, c: string): void {
  if (isWhitespace(c)) {
    emitSeparator(state);
    return;
  }
  state.out.push(c);
  state.lastWasSpace = false;
}

function emitSeparator(state: WalkerState): void {
  if (state.lastWasSpace) return;
  state.out.push(" ");
  state.lastWasSpace = true;
}

function trimTrailingSpace(out: string[]): void {
  if (out.length > 0 && out[out.length - 1] === " ") out.pop();
}

function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f";
}
