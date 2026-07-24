// Sectioned delivery of the collection-authoring reference
// (`collection-skills.md`). Served whole, the doc is a ~75KB tool result
// that overflows the agent's per-result limit — the failure mode that
// pushed an agent back to copying example schemas instead of reading the
// reference `schemaDocs` exists to serve. Rendering is keyed off the
// doc's own markdown headings, so the doc keeps growing without this
// module needing to know its outline:
//   - no topic → the core authoring guide (intro, anatomy, the DSL and
//     its field types, create/edit walkthroughs) + a table of contents
//   - topic    → the matching section(s), subsections included
//   - "all"    → the historical full dump, for callers that insist
import { defangForPrompt } from "../core/promptSafety";

/** A doc at/below this size is returned whole — sectioning something the
 *  agent can read in one gulp only costs round-trips. This is also what
 *  keeps short user-authored workspace copies (config/helps) verbatim. */
export const SCHEMA_DOCS_VERBATIM_LIMIT = 20_000;

/** Ceiling for ANY assembled reply — topic or default — safely inside
 *  the agent's per-result limit (the full doc is what overflowed it).
 *  A matched section too large to fit degrades to its own prose plus a
 *  list of its subsections to fetch individually; an oversized leaf is
 *  clipped outright; the default drops whole core sections into a
 *  pointer note. Sized so the CURRENT bundled doc's default reply
 *  (~33KB) fits without degrading. */
export const SCHEMA_DOCS_RESULT_BUDGET = 36_000;

/** Hard truncation for a body no sectioning trick can shrink further.
 *  The marker tells the agent it did NOT see everything and how to get
 *  the rest, so a silent cut can't read as complete coverage. The limit
 *  is clamped at zero: a negative limit would make `slice(0, limit)`
 *  count from the END and return almost the whole body — the exact
 *  overflow this function exists to prevent. */
function clip(text: string, limit: number): string {
  const max = Math.max(0, limit);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[…clipped ${text.length - max} chars — fetch a narrower \`topic\`, or read the doc file directly]`;
}

/** Slack a budget-spending assembler must reserve for what it adds
 *  AROUND the budgeted pieces — clip markers, join separators, pointer
 *  notes — so the final hard cap doesn't eat the reply's own tail (in
 *  renderDefault's case, the TOC). */
const ASSEMBLY_RESERVE = 500;

/** The sections every schema author needs, matched against headings so
 *  the doc can be reorganised without touching this list (an unmatched
 *  pattern is simply skipped): what a collection IS, the schema DSL and
 *  its field types, and the create/edit walkthroughs. Advanced sections
 *  (actions, bells, views, dataSource, storage) stay TOC-only. */
const CORE_SECTION_PATTERNS = ["anatomy", "skill.md", "the dsl", "field types", "end-to-end", "editing an existing"];

interface DocSection {
  level: number;
  heading: string;
  /** Line index of the heading itself. */
  start: number;
  /** Exclusive end of the section's own prose: the next heading of ANY level. */
  ownEnd: number;
  /** Exclusive end of the section's subtree: the next heading of level <= own. */
  deepEnd: number;
}

/** Backticks stripped + lowercased, so `topic: "dataSource"` matches the
 *  heading "External data (CSV) collections — `dataSource`". */
const normalize = (text: string): string => text.toLowerCase().replace(/`/g, "");

const sliceLines = (lines: string[], from: number, until: number): string => lines.slice(from, until).join("\n").trim();

/** All `#`–`###` headings, skipping fenced code blocks (a `# comment`
 *  inside an example must not become a section boundary). */
function headingLines(lines: string[]): { index: number; level: number; heading: string }[] {
  const found: { index: number; level: number; heading: string }[] = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    const match = fenced ? null : /^(#{1,3}) (.+)$/.exec(line);
    if (match) found.push({ index, level: match[1].length, heading: match[2].trim() });
  });
  return found;
}

function parseSections(lines: string[]): DocSection[] {
  const heads = headingLines(lines);
  return heads.map((head, i) => {
    const closer = heads.slice(i + 1).find((other) => other.level <= head.level);
    return {
      level: head.level,
      heading: head.heading,
      start: head.index,
      ownEnd: heads[i + 1]?.index ?? lines.length,
      deepEnd: closer?.index ?? lines.length,
    };
  });
}

/** Bounded to half the reply budget: every render path appends the TOC,
 *  so a doc with thousands of headings must not blow the ceiling through
 *  the TOC itself — and renderDefault subtracts the TOC's length from
 *  its budget, which must stay positive. */
function tableOfContents(sections: DocSection[]): string {
  const rows = sections.map((section) => `${"  ".repeat(section.level - 1)}- ${section.heading}`);
  return clip(
    `Sections (call schemaDocs with \`topic: "<heading>"\` for any of them; \`topic: "all"\` for the full document):\n${rows.join("\n")}`,
    Math.floor(SCHEMA_DOCS_RESULT_BUDGET / 2),
  );
}

/** The no-topic reply: the doc's intro + the core authoring sections
 *  (own prose only — a core parent's advanced subsections stay TOC-only),
 *  closed by the full table of contents. Budgeted: a core section that
 *  no longer fits is dropped into a pointer note (the first is clipped
 *  instead, so the reply is never bodiless) — an oversized workspace
 *  copy must not recreate the overflow this module exists to prevent. */
function renderDefault(lines: string[], sections: DocSection[]): string {
  const isCore = (section: DocSection, index: number) => index === 0 || CORE_SECTION_PATTERNS.some((pattern) => normalize(section.heading).includes(pattern));
  const toc = tableOfContents(sections);
  const parts: string[] = [];
  const skipped: string[] = [];
  let remaining = SCHEMA_DOCS_RESULT_BUDGET - toc.length - ASSEMBLY_RESERVE;
  for (const section of sections.filter(isCore)) {
    const body = sliceLines(lines, section.start, section.ownEnd);
    if (body.length > remaining && parts.length > 0) {
      skipped.push(section.heading);
      continue;
    }
    const fitted = clip(body, remaining);
    parts.push(fitted);
    remaining -= fitted.length;
  }
  const note = skipped.length > 0 ? `\n\n[Omitted for size — fetch each with \`topic\`: ${skipped.join(" · ")}]` : "";
  return `${parts.join("\n\n")}${note}\n\n---\n\n${toc}`;
}

/** Case-insensitive substring match on headings, minus any match already
 *  contained in another match's subtree (its parent's deep body covers it). */
function matchSections(sections: DocSection[], topic: string): DocSection[] {
  const needle = normalize(topic).trim();
  const matched = sections.filter((section) => normalize(section.heading).includes(needle));
  return matched.filter((section) => !matched.some((other) => other !== section && other.start < section.start && section.deepEnd <= other.deepEnd));
}

/** One matched section: its whole subtree when that fits the budget,
 *  otherwise its own prose (budget-clipped) + a pointer list of
 *  subsections to fetch — the list clipped to what the prose left over
 *  (thousands of child headings must not overflow through the list
 *  itself) — and a leaf with no subsections to offer is simply clipped. */
function renderSection(lines: string[], sections: DocSection[], section: DocSection, budget: number): string {
  const deep = sliceLines(lines, section.start, section.deepEnd);
  if (deep.length <= budget) return deep;
  const children = sections.filter((child) => child.start > section.start && child.start < section.deepEnd && child.level === section.level + 1);
  const own = clip(sliceLines(lines, section.start, section.ownEnd), budget);
  if (children.length === 0) return own;
  const list = clip(children.map((child) => `- ${child.heading}`).join("\n"), budget - own.length);
  return `${own}\n\nSubsections (too large to include together — fetch each with \`topic\`):\n${list}`;
}

function renderTopic(lines: string[], sections: DocSection[], topic: string): string {
  const matched = matchSections(sections, topic);
  if (matched.length === 0) {
    return `manageCollection: no schemaDocs section matches '${defangForPrompt(topic)}'.\n\n${tableOfContents(sections)}`;
  }
  const perMatch = Math.floor(SCHEMA_DOCS_RESULT_BUDGET / matched.length);
  return matched.map((section) => renderSection(lines, sections, section, perMatch)).join("\n\n");
}

/** Render the authoring reference for one schemaDocs call. Small docs and
 *  docs without headings pass through verbatim — there is nothing better
 *  to key a section off. The assembled reply gets one final hard cap: the
 *  inner budgeting degrades gracefully, but per-piece overheads (clip
 *  markers on thousands of matches, join separators, pointer notes) add
 *  up outside any single piece's budget, and the ceiling must hold no
 *  matter what shape of document arrives. Only the explicit \`"all"\`
 *  opt-in and the small-doc verbatim path may exceed it. */
export function renderSchemaDocs(doc: string, topic?: string): string {
  const requested = topic?.trim() ?? "";
  if (normalize(requested) === "all") return doc;
  if (doc.length <= SCHEMA_DOCS_VERBATIM_LIMIT) return doc;
  const lines = doc.split("\n");
  const sections = parseSections(lines);
  if (sections.length === 0) return doc;
  return clip(requested ? renderTopic(lines, sections, requested) : renderDefault(lines, sections), SCHEMA_DOCS_RESULT_BUDGET);
}
