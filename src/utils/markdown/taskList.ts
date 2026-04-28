// GFM task-list helpers for the markdown viewer (#775).
//
// Two pieces, both pure / DOM-free so they can be unit tested:
//
//  - `toggleTaskAt(markdown, taskIndex)` — toggle the n-th `- [ ]` /
//    `- [x]` line in the source. Walks lines and skips fenced code
//    blocks so a literal task-looking line inside ``` ... ``` is not
//    counted, matching what `marked` renders.
//
//  - `makeTasksInteractive(html)` — strip the `disabled=""` attribute
//    that marked puts on rendered task checkboxes and tag them with
//    `class="md-task"` so the click handler can find them via DOM
//    delegation. We post-process the HTML rather than override
//    marked's renderer to avoid mutating the global `marked` instance
//    (which is also used by wiki/View.vue, where this PR doesn't yet
//    enable interactive tasks).

// Matches a GFM task-list marker at the start of a list line. The
// `prefix` group absorbs leading whitespace plus any blockquote
// markers (`>`, possibly nested), so:
//   - [ ] foo
//   * [x] bar
//   1. [ ] dot-style ordered
//   1) [ ] paren-style ordered
//   > - [ ] quoted
//   > > - [ ] nested-quoted
// all match. `marked` renders all of these as a real task checkbox,
// so they need to be counted (and writable) by the index walker.
//
// Captures: prefix (indent + any `>` chains), bullet, separator, mark.
// `\s*` and `>\s*` operate on disjoint character classes from the
// surrounding bullet / separator / mark, so the nested quantifiers
// can't overlap to produce ReDoS — each pass is linear in line length.
// eslint-disable-next-line security/detect-unsafe-regex -- markdown task-line parser, bounded captures with hard delimiters
const TASK_LINE = /^(\s*(?:>\s*)*)([-*+]|\d+[.)])(\s+)\[([ xX])\]/;

// Fenced code block opener/closer. CommonMark allows fences to be
// indented up to 3 spaces; ≥ 4 leading spaces makes the line literal
// content of an indented code block, so we must NOT treat that as a
// fence — otherwise the index-counter drifts. ``` and ~~~ are both
// legal; the closing fence must use the same character as the opener.
//
// `stepFence` strips any leading blockquote prefix before applying
// this regex so blockquote-wrapped fences (`> ``` ... `> ``` `) are
// recognised. Without that, content inside a quoted fence would
// be walked at top level and any `> - [ ]`-shaped line inside would
// be miscounted as a task — making the View's count-cross-check
// refuse all toggles in the whole document.
const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})/;
// eslint-disable-next-line security/detect-unsafe-regex -- bounded blockquote-prefix parser; `\s*` / `>\s?` / outer `+` operate on disjoint character classes (no overlap)
const BLOCKQUOTE_PREFIX = /^(\s*(?:>\s?)+)/;

// Mutable state for the line walker. Pulled out so the main toggle
// function reads as a flat loop rather than a state-machine swamp.
interface FenceState {
  inFence: boolean;
  marker: string | null;
}

// Update fence state for a single line. Returns true when the line is
// part of a fence (opener, closer, or interior) and should be skipped
// by the task counter.
function stepFence(line: string, state: FenceState): boolean {
  // Strip a blockquote prefix (one or more `>` markers) so a fence
  // line written as `> ```` is recognised the same as a top-level
  // ` ``` `. Inside the blockquote, the 0-3-space indent rule of
  // FENCE_LINE still applies relative to the post-quote content, so
  // `>     ``` ` (≥ 4 spaces of content indent) is correctly NOT a
  // fence.
  const quoteMatch = line.match(BLOCKQUOTE_PREFIX);
  const content = quoteMatch ? line.slice(quoteMatch[0].length) : line;
  const fenceMatch = content.match(FENCE_LINE);
  if (fenceMatch) {
    const marker = fenceMatch[2];
    if (!state.inFence) {
      // Openers may carry an info string after the marker
      // (e.g. "```ts"). We don't need to keep it — just enter
      // the fenced region.
      state.inFence = true;
      state.marker = marker;
      return true;
    }
    // Closer rules per CommonMark §4.5:
    //   (a) same character as opener
    //   (b) length ≥ opener
    //   (c) NO info string — only whitespace allowed after the marker
    // Without (c), a line like "``` js" inside a fence would be
    // wrongly treated as the closer; marked keeps it as content.
    // (Slice from `content`, not `line` — fenceMatch[0] is relative
    // to the post-blockquote-strip content.)
    const afterMarker = content.slice(fenceMatch[0].length);
    if (state.marker && marker[0] === state.marker[0] && marker.length >= state.marker.length && /^\s*$/.test(afterMarker)) {
      state.inFence = false;
      state.marker = null;
      return true;
    }
    // A fence-shaped line that doesn't satisfy the closer rule is
    // still inside the open fence — skip it like any other content.
    return true;
  }
  return state.inFence;
}

// Apply the [ ]/[x] flip captured by `TASK_LINE` and rebuild the line
// with the rest of the original text intact. `prefix` includes any
// indentation plus blockquote markers so quoted tasks like
// `> - [ ] foo` round-trip cleanly.
function flipMark(line: string, match: RegExpMatchArray): string {
  const [whole, prefix, bullet, sep, mark] = match;
  const flipped = mark === " " ? "x" : " ";
  return `${prefix}${bullet}${sep}[${flipped}]` + line.slice(whole.length);
}

/** Find the source-line index of every task-list item, in document
 *  order, skipping content inside fenced code blocks. Returned array
 *  length is the total task count the source-side walker sees.
 *
 *  Exported so callers can cross-check the count against marked's
 *  rendered DOM (`input.md-task` element count). When the two
 *  disagree the source has tasks that marked is treating as code
 *  (e.g. content of a 4-space indented code block) — the only safe
 *  reaction is to refuse the click, never blindly toggle the
 *  source-side n-th line.
 */
export function findTaskLines(source: string): number[] {
  const lines = source.split("\n");
  const fence: FenceState = { inFence: false, marker: null };
  const taskLines: number[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (stepFence(line, fence)) continue;
    if (TASK_LINE.test(line)) taskLines.push(lineIdx);
  }
  return taskLines;
}

/** Toggle the n-th task-list checkbox in `source`. Returns the new
 *  markdown, or `null` if the index is out of range or the matched
 *  line isn't actually a task line (defensive against source/DOM
 *  drift). Indexing matches `marked`'s render order: top-down,
 *  document order, skipping content inside fenced code blocks.
 *
 *  Known limitation: 4-space *indented* code blocks (the alternative
 *  to fenced) aren't tracked, so a `    - [ ] foo` line written as
 *  literal code inside an indented block would be counted as a task
 *  even though `marked` renders it verbatim. Full CommonMark indented-
 *  code-block detection is context-dependent (needs blank-line
 *  history, list-continuation column, etc.); the practical workaround
 *  is twofold: (1) prefer fenced code for samples that contain task
 *  syntax, and (2) the caller cross-checks `findTaskLines(source).length`
 *  against the rendered DOM's `input.md-task` count and refuses to
 *  write when they disagree, so the worst case is a no-op click — not
 *  data corruption.
 */
export function toggleTaskAt(source: string, taskIndex: number): string | null {
  if (!Number.isInteger(taskIndex) || taskIndex < 0) return null;
  const taskLines = findTaskLines(source);
  if (taskIndex >= taskLines.length) return null;
  const lineIdx = taskLines[taskIndex];
  const lines = source.split("\n");
  const taskMatch = lines[lineIdx].match(TASK_LINE);
  if (!taskMatch) return null;
  lines[lineIdx] = flipMark(lines[lineIdx], taskMatch);
  return lines.join("\n");
}

/** Strip `disabled=""` from rendered GFM task checkboxes and tag them
 *  with `class="md-task"` so the viewer's click delegation can find
 *  them. Idempotent — running twice on the same HTML is a no-op on
 *  the second pass (the `disabled` attribute is gone). */
export function makeTasksInteractive(html: string): string {
  // marked v18 default output:
  //   <input disabled="" type="checkbox">         (unchecked)
  //   <input checked="" disabled="" type="checkbox">  (checked)
  // Both end with ` type="checkbox">`. Capture everything between
  // `<input ` and `disabled=""` (typically empty or `checked="" `)
  // and re-emit with `class="md-task"` in disabled's slot.
  return html.replace(/<input ([^>]*)disabled="" type="checkbox">/g, '<input $1class="md-task" type="checkbox">');
}
