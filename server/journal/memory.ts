// Pure helpers for parsing and updating ~/mulmoclaude/memory.md.
//
// The file is a single markdown document with one `##` section per
// memory category: User / Feedback / Project / Reference. Section
// bodies are bullet lists; each bullet is one memory entry.
//
// Anything outside those four known sections is preserved verbatim
// (preamble before the first known section, trailing content after
// the last). This lets the user hand-edit memory.md between auto
// runs without losing additions.

export type MemoryType = "user" | "feedback" | "project" | "reference";

export const MEMORY_TYPES: readonly MemoryType[] = [
  "user",
  "feedback",
  "project",
  "reference",
];

export interface MemoryEntry {
  type: MemoryType;
  /** Single-line bullet text. Renders as `- <body>`. */
  body: string;
}

export interface ParsedMemory {
  /** Everything before the first known section heading, verbatim. */
  preamble: string;
  /** Bullet lines per section, in source order, with the leading
   *  `- ` stripped. */
  sections: Record<MemoryType, string[]>;
  /** Anything after the last known section that isn't itself a
   *  known section. Preserved verbatim so user-added headings /
   *  prose at the bottom survive an auto-write. */
  trailing: string;
}

const SECTION_HEADINGS: Record<MemoryType, string> = {
  user: "## User",
  feedback: "## Feedback",
  project: "## Project",
  reference: "## Reference",
};

const HEADING_TO_TYPE: ReadonlyMap<string, MemoryType> = new Map(
  (Object.entries(SECTION_HEADINGS) as [MemoryType, string][]).map(
    ([type, heading]) => [heading.toLowerCase(), type],
  ),
);

function emptySections(): Record<MemoryType, string[]> {
  return { user: [], feedback: [], project: [], reference: [] };
}

/** Parse memory.md into preamble + per-type bullet lists + trailing. */
export function parseMemory(raw: string): ParsedMemory {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const sections = emptySections();
  const preambleLines: string[] = [];
  const trailingLines: string[] = [];

  let currentType: MemoryType | null = null;
  let sawAnyKnownSection = false;

  for (const line of lines) {
    const headingType = matchSectionHeading(line);
    if (headingType !== null) {
      currentType = headingType;
      sawAnyKnownSection = true;
      continue;
    }
    // A non-known `##` heading after we've started consuming
    // sections means we're past the auto-managed area; everything
    // from here to EOF goes into trailing.
    if (sawAnyKnownSection && /^##\s/.test(line) && currentType !== null) {
      trailingLines.push(line);
      currentType = null;
      continue;
    }
    if (currentType === null) {
      if (sawAnyKnownSection) {
        trailingLines.push(line);
      } else {
        preambleLines.push(line);
      }
      continue;
    }
    const bullet = matchBullet(line);
    if (bullet !== null) {
      sections[currentType].push(bullet);
    }
    // Non-bullet content inside a known section is dropped — we
    // own the body of those sections. If a user wants prose, they
    // can put it in preamble or in their own custom heading.
  }

  return {
    preamble: stripTrailingBlankLines(preambleLines.join("\n")),
    sections,
    trailing: stripLeadingBlankLines(trailingLines.join("\n")).trimEnd(),
  };
}

/** Add new entries to the right sections. Skips entries whose body
 *  is already present (case-insensitive substring match) so the
 *  file doesn't grow with duplicates the LLM happens to re-emit. */
export function appendEntries(
  parsed: ParsedMemory,
  entries: readonly MemoryEntry[],
): ParsedMemory {
  if (entries.length === 0) return parsed;
  const next: ParsedMemory = {
    preamble: parsed.preamble,
    sections: {
      user: [...parsed.sections.user],
      feedback: [...parsed.sections.feedback],
      project: [...parsed.sections.project],
      reference: [...parsed.sections.reference],
    },
    trailing: parsed.trailing,
  };
  for (const entry of entries) {
    const body = entry.body.trim();
    if (body.length === 0) continue;
    const list = next.sections[entry.type];
    const lower = body.toLowerCase();
    const isDup = list.some((existing) =>
      existing.toLowerCase().includes(lower),
    );
    if (!isDup) list.push(body);
  }
  return next;
}

/** Render parsed memory back to markdown. Empty sections are
 *  omitted (re-added the next time an entry of that type lands).
 *  The four known sections are emitted in canonical order
 *  (User → Feedback → Project → Reference) regardless of the
 *  order they appeared in the input file. */
export function renderMemory(parsed: ParsedMemory): string {
  const blocks: string[] = [];
  if (parsed.preamble.trim().length > 0) {
    blocks.push(parsed.preamble);
  }
  for (const type of MEMORY_TYPES) {
    const items = parsed.sections[type];
    if (items.length === 0) continue;
    const heading = SECTION_HEADINGS[type];
    const body = items.map((b) => `- ${b}`).join("\n");
    blocks.push(`${heading}\n\n${body}`);
  }
  if (parsed.trailing.trim().length > 0) {
    blocks.push(parsed.trailing);
  }
  return blocks.join("\n\n") + "\n";
}

function matchSectionHeading(line: string): MemoryType | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("## ")) return null;
  return HEADING_TO_TYPE.get(trimmed.toLowerCase()) ?? null;
}

// Recognises `- foo` and `* foo` bullets. Returns the body without
// the marker; null when the line is not a bullet. Hand-rolled
// linear scan so sonarjs/slow-regex doesn't flag the obvious
// `^\s*[-*]\s+(.*)$` regex form (which is fine but tripwires the
// lint rule on capture-after-quantifier).
function matchBullet(line: string): string | null {
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  if (i >= line.length) return null;
  if (line[i] !== "-" && line[i] !== "*") return null;
  i++;
  if (i >= line.length || (line[i] !== " " && line[i] !== "\t")) return null;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return line.slice(i).trimEnd();
}

function stripTrailingBlankLines(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "\n") end--;
  return s.slice(0, end);
}

function stripLeadingBlankLines(s: string): string {
  let i = 0;
  while (i < s.length && s[i] === "\n") i++;
  return s.slice(i);
}
