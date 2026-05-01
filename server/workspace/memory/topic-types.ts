// Topic-based memory schema (#1070). Each file groups related
// bullets under a single topic. The frontmatter carries the type
// and topic name; the body is markdown (H1 + optional H2 sections +
// bullets). Coexists with #1029's atomic files during the
// transition — PR-B retires the atomic format.

import type { MemoryType } from "./types.js";

export interface TopicMemoryFile {
  type: MemoryType;
  /** Filename without `.md`. Stable identifier; the index links to it. */
  topic: string;
  /** Raw markdown body — H1 heading + H2 subsections + bullets. */
  body: string;
  /** H2 headings extracted from the body, in source order, with
   *  whitespace trimmed. The index renders these as the file's
   *  "tags". Empty array when the file has no H2 yet (a young
   *  topic with only bullets directly under H1). */
  sections: string[];
}

// Pull H2 headings out of the body. Pure / regex-free / iterable so
// a long body can't trip sonarjs. `##` followed by space OR tab is
// accepted so a markdown file authored with mixed indentation
// doesn't silently lose tags. `###` and deeper are NOT treated as
// tags so the file can use them for further structure without
// leaking into the index.
export function extractH2Sections(body: string): string[] {
  const sections: string[] = [];
  for (const lineRaw of body.split("\n")) {
    const line = stripCarriageReturn(lineRaw);
    if (!isH2Line(line)) continue;
    const heading = line.slice(2).trim();
    if (heading.length > 0) sections.push(heading);
  }
  return sections;
}

function isH2Line(line: string): boolean {
  if (!line.startsWith("##")) return false;
  if (line.startsWith("###")) return false;
  if (line.length === 2) return false;
  const [, , next] = line;
  return next === " " || next === "\t";
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// Maximum length of a topic slug (filename without `.md`). Both the
// slugifier and the safety gate honour this cap, and downstream
// callers that suffix a slug (e.g. collision resolution in
// `topic-migrate`'s `pickUniqueSlug`) must trim the base so the
// suffixed result still fits.
export const MAX_TOPIC_SLUG_LENGTH = 60;

// Slugify a topic name for use as a filename. `<type>/<topic>.md`
// must keep `topic` filesystem-safe and short. Collapses anything
// non-alnum into a single `-`, lowercases, trims trailing
// separators, caps at MAX_TOPIC_SLUG_LENGTH chars. Returns null when
// the result is empty (caller decides whether to fall back to a
// hash).
export function slugifyTopicName(name: string): string | null {
  const lower = name.toLowerCase();
  const out: string[] = [];
  let lastWasSep = true;
  for (const char of lower) {
    if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9")) {
      out.push(char);
      lastWasSep = false;
    } else if (!lastWasSep) {
      out.push("-");
      lastWasSep = true;
    }
  }
  while (out.length > 0 && out[out.length - 1] === "-") out.pop();
  const compact = out.slice(0, MAX_TOPIC_SLUG_LENGTH).join("");
  return compact.length > 0 ? trimTrailing(compact, "-") : null;
}

function trimTrailing(text: string, char: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end -= 1;
  return text.slice(0, end);
}

// Strict shape gate: lowercase alnum + `-` only, length 1–60, no
// leading / trailing `-`, not the reserved index name. The
// strictness is intentional: a clusterer's first attempt at a topic
// slug is often a free-form phrase ("AI Research Papers!"), and we
// want such inputs to fall through to `slugifyTopicName` rather
// than land verbatim on the filesystem with spaces / punctuation
// baked in. `isSafeMemorySlug` from #1029 was looser to allow
// unicode body suffixes; here we force the slug format to be
// filename-friendly so the topic doubles as the path component.
export function isSafeTopicSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length === 0) return false;
  if (slug.length > MAX_TOPIC_SLUG_LENGTH) return false;
  if (slug.startsWith("-") || slug.endsWith("-")) return false;
  for (const char of slug) {
    const ok = (char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "-";
    if (!ok) return false;
  }
  if (slug === "memory") return false;
  return true;
}
