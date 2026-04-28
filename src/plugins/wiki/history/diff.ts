import { diffLines } from "diff";

// Keys that `writeWikiPage` auto-stamps on every save. Diffing
// these would surface a change on every snapshot even when the
// user touched nothing meaningful (Q5 in the PR 3 plan).
const AUTO_STAMP_KEYS = ["updated", "editor"] as const;

export type DiffLineKind = "context" | "add" | "del";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** A contiguous viewport into the diff. Between hunks there are
 *  unchanged lines that have been collapsed to keep the view
 *  readable; the renderer surfaces those gaps via `hiddenBefore`
 *  and (on the last hunk only) `hiddenAfter`. */
export interface DiffHunk {
  lines: DiffLine[];
  /** Unchanged lines collapsed before this hunk (i.e. between the
   *  previous hunk's end and this hunk's start, or between BOF and
   *  the first hunk). 0 when nothing is hidden. */
  hiddenBefore: number;
  /** Unchanged lines collapsed after this hunk and before EOF.
   *  Always 0 except on the last hunk. */
  hiddenAfter: number;
}

/** Compute a line-level unified diff with ±N context.
 *
 *  Returns an empty array when `left === right` — there are no
 *  changes to surface. Otherwise builds hunks: each one is a
 *  contiguous run that contains at least one add/del line plus up
 *  to `contextLines` unchanged lines on each side. When two
 *  changes are within `2 * contextLines` of each other their
 *  context windows overlap and the hunks merge. */
export function renderUnifiedDiff(left: string, right: string, contextLines = 3): DiffHunk[] {
  if (left === right) return [];

  const changes = diffLines(left, right);
  const lines: DiffLine[] = [];
  for (const change of changes) {
    const kind: DiffLineKind = change.added ? "add" : change.removed ? "del" : "context";
    for (const text of splitLines(change.value)) {
      lines.push({ kind, text });
    }
  }

  const changedIndices: number[] = [];
  lines.forEach((line, idx) => {
    if (line.kind !== "context") changedIndices.push(idx);
  });
  if (changedIndices.length === 0) return [];

  const ranges = mergeWithContext(changedIndices, contextLines, lines.length);

  return ranges.map((range, idx) => {
    const hunkLines = lines.slice(range.start, range.end + 1);
    const prevEnd = idx === 0 ? -1 : ranges[idx - 1].end;
    const hiddenBefore = range.start - prevEnd - 1;
    const hiddenAfter = idx === ranges.length - 1 ? lines.length - 1 - range.end : 0;
    return { lines: hunkLines, hiddenBefore, hiddenAfter };
  });
}

interface Range {
  start: number;
  end: number;
}

function mergeWithContext(changedIndices: number[], contextLines: number, totalLines: number): Range[] {
  const out: Range[] = [];
  for (const idx of changedIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(totalLines - 1, idx + contextLines);
    const last = out[out.length - 1];
    // Two ranges merge when their context windows are adjacent or
    // overlap — the gap-of-zero case (last.end + 1 === start) is a
    // legitimate merge because there are no hidden lines between.
    if (last && last.end + 1 >= start) {
      last.end = Math.max(last.end, end);
    } else {
      out.push({ start, end });
    }
  }
  return out;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  // A block that ended with `\n` produces an empty trailing element
  // from `split` — drop it. A block that did NOT end with `\n` (rare
  // with diffLines, but possible at EOF) keeps its content.
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Strip the keys that `writeWikiPage` auto-stamps on every save
 *  so the diff focuses on user-meaningful frontmatter only (Q5). */
export function stripAutoStampKeys(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if ((AUTO_STAMP_KEYS as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Re-serialise `frontmatter + body` for diffing. The result is a
 *  plain string — the diff library doesn't care about YAML; it
 *  just needs two strings to compare. We sort frontmatter keys so
 *  semantic equality (same keys, possibly reordered) doesn't show
 *  up as a diff. */
export function joinFrontmatterAndBody(meta: Record<string, unknown>, body: string): string {
  const sortedKeys = Object.keys(meta).sort();
  if (sortedKeys.length === 0) return body;
  const frontmatterLines = ["---"];
  for (const key of sortedKeys) {
    frontmatterLines.push(`${key}: ${formatYamlValue(meta[key])}`);
  }
  frontmatterLines.push("---");
  frontmatterLines.push("");
  return `${frontmatterLines.join("\n")}\n${body}`;
}

function formatYamlValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map((item) => formatYamlValue(item)).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") {
    // Quote when needed — leading / trailing whitespace, special
    // YAML chars, or embedded colon-space (which YAML reads as a
    // mapping). Plain alphanumerics + hyphens stay unquoted.
    if (/^[A-Za-z0-9_\-./]+$/.test(value)) return value;
    return JSON.stringify(value);
  }
  return String(value);
}
