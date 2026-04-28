// Server-side mirror of `src/utils/markdown/frontmatter.ts`
// (#895 PR B). The two share the same shape on purpose so the
// parser/serializer/merger contract is identical on both sides
// — what writeWikiPage emits round-trips losslessly through the
// Vue useMarkdownDoc composable.
//
// Code is intentionally NOT a shared package: the wrapper is ~10
// lines on each side, and a workspace package would need cross-
// build wiring (browser bundle for Vue, plain Node for server)
// that's not worth it for so little glue. js-yaml does the heavy
// lifting in both places, identically.

import yaml from "js-yaml";

export interface ParsedMarkdown {
  /** Parsed YAML object. Empty `{}` when the document has no
   *  frontmatter or the YAML failed to parse. Insertion order
   *  matches the source so callers iterating `Object.entries`
   *  see fields in the order the file declared them. */
  meta: Record<string, unknown>;
  /** Body after stripping the frontmatter envelope. The trailing
   *  newline of the closing `---` line is consumed; a no-frontmatter
   *  document returns the raw input verbatim. */
  body: string;
  /** True iff a well-formed `---\n...\n---\n` envelope was
   *  detected and parsed. Malformed YAML inside an envelope
   *  degrades to `hasHeader: false` so a typo in the header
   *  doesn't break writes. */
  hasHeader: boolean;
}

const FRONTMATTER_OPEN = /^---\r?\n/;
// `(?:^|\r?\n)` lets the closing fence sit at the very start of
// `afterOpen` — needed for empty envelopes (`---\n---\n`) where
// the closing `---` is the first thing after the open is stripped.
const FRONTMATTER_CLOSE = /(?:^|\r?\n)---\s*(?:\r?\n|$)/;

/** Parse a markdown document, splitting frontmatter from body.
 *  Always returns an object — never throws. */
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
 *  Source-text formatting may change on save but the parsed value
 *  is stable across rounds. */
export function serializeWithFrontmatter(meta: Record<string, unknown>, body: string): string {
  if (Object.keys(meta).length === 0) return body;
  // `lineWidth: -1` disables auto-wrap so long URLs / titles stay on
  // one line. `noRefs: true` avoids YAML anchor syntax (`&id001`)
  // which is technically valid but visually noisy in plain-text
  // markdown.
  const yamlText = yaml.dump(meta, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${yamlText}\n---\n\n${body}`;
}

/** Merge a patch into an existing meta object. Unknown keys in
 *  `existing` are preserved verbatim; keys present in `patch`
 *  overwrite. A `null` or `undefined` patch value DELETES the key
 *  (REST PATCH semantics) — callers that want "leave alone"
 *  should omit the key entirely. */
export function mergeFrontmatter(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) {
      delete out[key];
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
    //   - YAML 1.1 dates (`created: 2026-04-27`) would become a
    //     `Date` object under DEFAULT_SCHEMA, breaking round-trip.
    //   - Numeric-looking strings (`version: 1.20` → 1.2 under
    //     JSON_SCHEMA) drop trailing zeros on save.
    // For the wiki-history use case — title / created / updated /
    // tags / editor — every value that should be a string IS one.
    const loaded = yaml.load(text, { schema: yaml.FAILSAFE_SCHEMA });
    if (loaded === null || loaded === undefined) return {};
    if (typeof loaded !== "object" || Array.isArray(loaded)) return null;
    return loaded as Record<string, unknown>;
  } catch {
    return null;
  }
}
