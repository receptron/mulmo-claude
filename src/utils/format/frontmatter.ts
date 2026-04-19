// Minimal YAML-frontmatter extractor for Markdown files. Only covers
// the shapes we actually display in the Files-mode preview:
//
//   ---
//   title: さくらインターネット
//   created: 2026-04-06
//   tags: [クラウド, インフラ, 日本企業]
//   ---
//
// Values are returned either as a string or, for inline arrays
// (`[a, b, c]`), as a string[]. Anything more exotic (block lists,
// nested maps, multi-line strings) is treated as an opaque string so
// the user still sees the raw value.

export type FrontmatterValue = string | string[];

export interface FrontmatterField {
  key: string;
  value: FrontmatterValue;
}

export interface Frontmatter {
  fields: FrontmatterField[];
  body: string;
}

const FRONTMATTER_DELIM = /^---\r?\n/;
const FRONTMATTER_CLOSE = /\r?\n---\s*(\r?\n|$)/;

export function extractFrontmatter(raw: string): Frontmatter {
  if (!FRONTMATTER_DELIM.test(raw)) {
    return { fields: [], body: raw };
  }
  const afterOpen = raw.replace(FRONTMATTER_DELIM, "");
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpen);
  if (!closeMatch || closeMatch.index === undefined) {
    return { fields: [], body: raw };
  }
  const fmText = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  return { fields: parseFields(fmText), body };
}

function parseFields(fmText: string): FrontmatterField[] {
  const fields: FrontmatterField[] = [];
  for (const line of fmText.split(/\r?\n/)) {
    const field = parseLine(line);
    if (field) fields.push(field);
  }
  return fields;
}

function parseLine(line: string): FrontmatterField | null {
  if (!line.trim() || line.trimStart().startsWith("#")) return null;
  const colonIdx = line.indexOf(":");
  if (colonIdx <= 0) return null;
  const key = line.slice(0, colonIdx).trim();
  const rawValue = line.slice(colonIdx + 1).trim();
  if (!key) return null;
  return { key, value: parseValue(rawValue) };
}

function parseValue(raw: string): FrontmatterValue {
  if (!raw) return "";
  const arrayMatch = /^\[(.*)\]$/.exec(raw);
  if (arrayMatch) {
    return arrayMatch[1]
      .split(",")
      .map((s) => unquote(s.trim()))
      .filter((s) => s.length > 0);
  }
  return unquote(raw);
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
