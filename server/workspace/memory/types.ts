// Typed memory schema (#1029). Each entry is a markdown file with a
// YAML frontmatter envelope. The directory layout, filename
// convention, and field set are documented in
// `plans/done/feat-memory-storage-utilities.md`.
//
// `type` is the source of truth for an entry's classification —
// filenames follow `<type>_<slug>.md` for ergonomics but the reader
// must trust the frontmatter, never the filename.

export const MEMORY_TYPES = ["preference", "interest", "fact", "reference"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryEntry {
  /** One-line human-readable label. Becomes the link text in MEMORY.md. */
  name: string;
  /** Short blurb shown after the link in MEMORY.md and used as the
   *  description hint when the agent decides whether to read the
   *  full entry. */
  description: string;
  type: MemoryType;
  /** Markdown body. The frontmatter envelope is stripped on parse and
   *  re-applied on write. */
  body: string;
  /** Filename without extension. Stable identifier used by the index
   *  link target. */
  slug: string;
}

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}

// Bound the alphanumeric portion of a slug. Long bullets in the
// legacy memory.md (e.g. paragraph-length recurring task descriptions)
// would otherwise produce slugs > 200 chars and trip
// `isSafeMemorySlug`'s upper bound, dropping the entry on disk. 80
// chars keeps the filename readable in `ls` output, leaves headroom
// under the safety cap, and is well under the 255-byte filename limit
// every supported filesystem honors.
const MAX_SLUG_BODY = 80;

// Slugify a name into a filename-safe token. ASCII-only conversion of
// [a-zA-Z0-9] segments; everything else collapses into a single `-`.
// The result is truncated to MAX_SLUG_BODY and any trailing `-` from
// the truncation is trimmed so the slug doesn't read like a partial
// word. Non-ASCII (Japanese / 中文) input falls back to the type
// prefix + short hash so two entries with all-non-ASCII names don't
// collide on the empty string. Uses an explicit char loop instead of
// regex so a deeply-recursive name can't trigger pathological
// backtracking.
export function slugifyMemoryName(name: string, type: MemoryType): string {
  const ascii = compactAlnum(name.toLowerCase());
  const bounded = trimTrailingSeparators(ascii.slice(0, MAX_SLUG_BODY));
  if (bounded.length > 0) return `${type}_${bounded}`;
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return `${type}_${hash.toString(36)}`;
}

function trimTrailingSeparators(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === "-") end -= 1;
  return text.slice(0, end);
}

function compactAlnum(text: string): string {
  const out: string[] = [];
  let lastWasSep = true;
  for (const char of text) {
    if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9")) {
      out.push(char);
      lastWasSep = false;
    } else if (!lastWasSep) {
      out.push("-");
      lastWasSep = true;
    }
  }
  while (out.length > 0 && out[out.length - 1] === "-") out.pop();
  return out.join("");
}
