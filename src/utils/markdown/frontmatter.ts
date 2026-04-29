// Canonical YAML-frontmatter parser / serializer / merger for the
// `---\nkey: value\n---\nbody` markdown convention. Used on the Vue
// side; the server side has a mirror at
// `server/utils/markdown/frontmatter.ts` (#895 PR B). The two share
// the same shape but live in separate files because the build
// targets are different (browser vs Node) and a shared package is
// overkill for ~10 lines of glue.
//
// Implementation uses `js-yaml` so we get full YAML coverage (block
// lists, multi-line strings, escaping) instead of the regex
// approximation in the legacy `src/utils/format/frontmatter.ts`.

import yaml from "js-yaml";

export interface ParsedMarkdown {
  /** Parsed YAML object. Empty `{}` when the document has no
   *  frontmatter or the YAML failed to parse. Insertion order
   *  matches the source — `Object.entries(meta)` is the right way
   *  to iterate for an ordered properties panel. */
  meta: Record<string, unknown>;
  /** Body after stripping the frontmatter envelope. Trailing
   *  newline at the end of the closing `---` line is consumed; a
   *  no-frontmatter document returns the raw input verbatim. */
  body: string;
  /** True iff a well-formed `---\n...\n---\n` envelope was
   *  detected and parsed. False for documents without an envelope
   *  or where the envelope is malformed (in which case the body
   *  is returned verbatim and `meta` is `{}`). */
  hasHeader: boolean;
}

const FRONTMATTER_OPEN = /^---\r?\n/;
// `(?:^|\r?\n)` lets the closing fence sit at the very start of
// `afterOpen` — needed for the empty-envelope case `---\n---\n`
// where the closing `---` is the first thing after the open is
// stripped. Without the alternation the regex required a preceding
// newline and silently treated empty headers as malformed.
const FRONTMATTER_CLOSE = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;

/** Parse a markdown document, splitting frontmatter from body.
 *  Always returns an object — never throws. Malformed YAML inside
 *  a well-formed envelope falls back to `{ meta: {}, hasHeader: false }`
 *  so a typo in the header doesn't break rendering. */
export function parseFrontmatter(raw: string): ParsedMarkdown {
  if (!FRONTMATTER_OPEN.test(raw)) {
    return { meta: {}, body: raw, hasHeader: false };
  }
  const afterOpen = raw.replace(FRONTMATTER_OPEN, "");
  const closeMatch = FRONTMATTER_CLOSE.exec(afterOpen);
  if (!closeMatch || closeMatch.index === undefined) {
    return { meta: {}, body: raw, hasHeader: false };
  }
  const yamlText = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  const meta = safeYamlLoad(yamlText);
  if (meta === null) {
    return { meta: {}, body: raw, hasHeader: false };
  }
  return { meta, body, hasHeader: true };
}

/** Serialize a meta object + body back into the canonical
 *  `---\n...\n---\n\nbody` shape. An empty `meta` returns the body
 *  alone (no envelope) — the lazy-on-write contract: don't add
 *  ceremony to documents that don't have anything to record.
 *
 *  Round-trip semantics: VALUE-preserving, NOT byte-preserving.
 *  `js-yaml` adds quotes to ambiguous scalars (`'1.20'`, `'true'`)
 *  so they parse back as the same string under FAILSAFE_SCHEMA.
 *  Source-text formatting (unquoted vs quoted) may change on save
 *  but the parsed value is stable across rounds (codex review
 *  iter-2 #902). */
export function serializeWithFrontmatter(meta: Record<string, unknown>, body: string): string {
  if (Object.keys(meta).length === 0) return body;
  // `lineWidth: -1` disables auto-wrap so long URLs / titles stay on
  // one line. `noRefs: true` avoids YAML anchor syntax (`&id001`)
  // which is technically valid but visually noisy in plain-text
  // markdown. js-yaml's default already trims a trailing newline.
  const yamlText = yaml.dump(meta, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${yamlText}\n---\n\n${body}`;
}

/** Merge a patch into an existing meta object. Unknown keys in
 *  `existing` are preserved verbatim; keys present in `patch`
 *  overwrite. A `null` or `undefined` patch value DELETES the key
 *  (pattern borrowed from REST PATCH semantics) — callers that
 *  want "leave alone" should omit the key entirely. */
export function mergeFrontmatter(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      Reflect.deleteProperty(out, key);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function safeYamlLoad(text: string): Record<string, unknown> | null {
  try {
    // `FAILSAFE_SCHEMA` keeps every scalar as a string and skips
    // type coercion. Two motivating cases:
    //
    //   - YAML 1.1 dates: `created: 2026-04-27` would become a
    //     `Date` object under DEFAULT_SCHEMA, breaking round-trip.
    //   - Numeric-looking strings: `version: 1.20` → number 1.2
    //     under JSON_SCHEMA, dropping the trailing zero on save
    //     (codex review iter-1 #902).
    //
    // For our domain — title / created / updated / tags / editor —
    // everything that should be a string IS one, and the rare
    // caller that wants a number can coerce explicitly. Mappings
    // and sequences still parse normally (FAILSAFE keeps those).
    const loaded = yaml.load(text, { schema: yaml.FAILSAFE_SCHEMA });
    // `yaml.load` returns `undefined` for empty input, a primitive
    // for scalar-only YAML, or an object for the normal case. Only
    // accept plain objects — anything else is a malformed header.
    if (loaded === null || loaded === undefined) return {};
    if (typeof loaded !== "object" || Array.isArray(loaded)) return null;
    return loaded as Record<string, unknown>;
  } catch {
    return null;
  }
}
