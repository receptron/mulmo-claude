// Shared HTML-tag URL rewriter — used by:
//   - browser markdown surface (`rewriteImgSrcAttrsInHtml` in
//     `rewriteMarkdownImageRefs.ts`) → rewrites to
//     `/api/files/raw?path=...`
//   - server PDF surface (`inlineImages` in
//     `server/api/routes/pdf.ts`) → rewrites to `data:` URIs
//
// Both used to keep their own copy of the same regex shape with a
// `// Mirrors the shape used by …` comment. That mirroring drifts the
// moment one side adds a tag (`<source>`, `<video poster>`) and the
// other doesn't. Single helper here, two callers, one tag list — the
// drift becomes structurally impossible (#1011 Stage B).
//
// `srcset` is handled by a dedicated split/rewrite pass (it's a
// comma-separated `url descriptor` list, not a single URL) — see
// `SRCSET_TAG_ATTRS` + `rewriteSrcset` below. SVG `<image href>` /
// CSS `url()` remain out of scope — see the deferred-list comment
// on `RESOLVABLE_TAG_ATTRS` below.

// Tag (lowercased) → URL-bearing attribute(s). Adding a row here
// extends both Markdown and PDF surfaces simultaneously.
//
// Deferred (NOT here):
//   - SVG `<image href>` — gap table item #9, low priority per plan
//     §修正提案 P3-A.
//   - CSS `url()` in `style=` attributes — gap table item #8, same
//     priority.
export const RESOLVABLE_TAG_ATTRS: Readonly<Record<string, readonly string[]>> = {
  img: ["src"],
  source: ["src"],
  video: ["poster", "src"],
  audio: ["src"],
};

// `srcset`-bearing attributes (comma-separated `url descriptor`
// list). Parsed/rewritten by `rewriteSrcset`, NOT the single-URL
// path. Tag set is a subset of `RESOLVABLE_TAG_ATTRS`'s keys so the
// outer tag regex already matches them — no alternation change
// needed (#1275, deferred from #1011 Stage B).
export const SRCSET_TAG_ATTRS: Readonly<Record<string, readonly string[]>> = {
  img: ["srcset"],
  source: ["srcset"],
};

function isSrcsetWs(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r";
}

interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

function stripTrailingCommas(token: string): string {
  let end = token.length;
  while (end > 0 && token[end - 1] === ",") end--;
  return token.slice(0, end);
}

function skipWsAndCommas(input: string, from: number): number {
  let pos = from;
  while (pos < input.length && (isSrcsetWs(input[pos]) || input[pos] === ",")) pos++;
  return pos;
}

// Read one `{ url, descriptor }` candidate starting at `from`.
// Returns the candidate (or null when only whitespace remained) and
// the position to resume from.
function readCandidate(input: string, from: number): { candidate: SrcsetCandidate | null; next: number } {
  let pos = from;
  const urlStart = pos;
  while (pos < input.length && !isSrcsetWs(input[pos])) pos++;
  const rawUrl = input.slice(urlStart, pos);
  const url = stripTrailingCommas(rawUrl);
  if (url.length !== rawUrl.length) {
    // Trailing comma(s) on the URL run → candidate separator, no
    // descriptor. (`data:` internal commas are not trailing, so
    // they stay part of the URL.)
    return { candidate: url ? { url, descriptor: "" } : null, next: pos };
  }
  while (pos < input.length && isSrcsetWs(input[pos])) pos++;
  const descStart = pos;
  while (pos < input.length && input[pos] !== ",") pos++;
  const descriptor = input.slice(descStart, pos).trim();
  if (pos < input.length && input[pos] === ",") pos++;
  return { candidate: url ? { url, descriptor } : null, next: pos };
}

// Split a `srcset` value into candidates per the WHATWG "parse a
// srcset attribute" boundary rules. A naive `split(",")` corrupts
// `data:` URIs (their base64 payload contains commas); the spec
// collects the URL as a run of non-whitespace and treats only
// *trailing* commas on that run as separators (Codex review). Pure
// scan, no regex → ReDoS-safe.
function splitSrcsetCandidates(input: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let pos = 0;
  while (pos < input.length) {
    pos = skipWsAndCommas(input, pos);
    if (pos >= input.length) break;
    const { candidate, next } = readCandidate(input, pos);
    pos = next;
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

// Rewrite the URL portion of every candidate in a `srcset` value,
// preserving descriptors (`1x` / `2x` / `480w`). If no candidate's
// URL is actually changed (every `transform` returned `null` or the
// same string), the ORIGINAL value is returned byte-verbatim so a
// no-op never normalises the author's whitespace (CodeRabbit
// review). Boundary parsing is `data:`-URI-safe (see
// `splitSrcsetCandidates`).
export function rewriteSrcset(value: string, transform: (url: string) => string | null): string {
  const candidates = splitSrcsetCandidates(value);
  if (candidates.length === 0) return value;
  let changed = false;
  const rendered = candidates.map(({ url, descriptor }) => {
    const replaced = transform(url);
    const finalUrl = replaced === null || replaced === url ? url : ((changed = true), replaced);
    return descriptor ? `${finalUrl} ${descriptor}` : finalUrl;
  });
  return changed ? rendered.join(", ") : value;
}

// Outer regex: scan any tag whose name appears in `RESOLVABLE_TAG_ATTRS`,
// respecting quoted attribute values so `>` inside e.g. `alt="x>y"`
// doesn't terminate the tag early. The body is one of:
//   - any non-`>` non-quote char     `[^>"']`
//   - a complete double-quoted span  `"[^"]*"`
//   - a complete single-quoted span  `'[^']*'`
// All branches bounded — no nested quantifiers, no overlap.
//
// The tag-name alternation is hand-listed rather than computed from
// `Object.keys(RESOLVABLE_TAG_ATTRS)` so the regex is a const string
// (lint-friendly) and the alternation order matches the readable
// declaration order. Adding a tag means: update the map AND the
// alternation here. The unit test in test_htmlSrcAttrs.ts pins this
// in lockstep so the two never disagree silently.
//
// eslint-disable-next-line security/detect-unsafe-regex -- bounded alternatives, ReDoS-safe (test in test_htmlSrcAttrs.ts)
const RESOLVABLE_TAG_OUTER_RE = /<(?:img|source|video|audio)\b(?:[^>"']|"[^"]*"|'[^']*')*\/?>/gi;
// Tag-name extractor for the matched outer tag. Anchored so we only
// read the leading `<name`, never an attribute value that happens to
// look like a tag.
const TAG_NAME_RE = /^<([a-z]+)/i;

// Attribute iterator: walks each `name=value` pair inside a tag. The
// leading `\s+` ensures we only match real attribute boundaries, not
// `src=` text embedded inside another attribute's quoted value.
// Capture groups:
//   1: leading whitespace
//   2: attribute name
//   3: `=` with surrounding spaces (only when value present)
//   4: full quoted/unquoted value (unused but captured for clarity)
//   5: double-quoted value (without quotes)
//   6: single-quoted value (without quotes)
//   7: unquoted value — refuses leading `"` / `'` so a malformed
//      `<img src="aaaa` (no closing quote) doesn't capture the stray
//      quote as the value
//
// All quantifiers bounded — verified ReDoS-safe in test_htmlSrcAttrs.ts.
// eslint-disable-next-line sonarjs/super-linear-regex, sonarjs/regex-complexity, security/detect-unsafe-regex -- bounded quantifiers, ReDoS-safe (test in test_htmlSrcAttrs.ts)
const ATTR_ITER_RE = /(\s+)([A-Za-z][\w:-]*)(?:(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>"'][^\s>]*)))?/g;

/** Transform every URL-bearing attribute on a recognised tag.
 *
 *  `transform` is invoked once per matching attribute value. Return:
 *    - `string` to substitute the value (callee is responsible for
 *      not breaking out of the surrounding quotes — most callers
 *      route through `encodeURIComponent` or a fixed-prefix path)
 *    - `null` to leave the attribute untouched (e.g. external URL,
 *      `data:` URI, escape-the-workspace path)
 *
 *  Other attributes (alt, class, style, …) and `src=`-shaped text
 *  inside their quoted values are preserved verbatim because we
 *  parse attribute-by-attribute, not by free-form regex.
 *
 *  Recognised tags + attributes live in `RESOLVABLE_TAG_ATTRS`. Any
 *  tag whose name isn't in the map is returned untouched. Any
 *  attribute on a recognised tag whose name isn't in the map's entry
 *  is also untouched. */
export function transformResolvableUrlsInHtml(html: string, transform: (url: string) => string | null): string {
  if (!html) return html;
  return html.replace(RESOLVABLE_TAG_OUTER_RE, (tag) => {
    const tagNameMatch = TAG_NAME_RE.exec(tag);
    if (!tagNameMatch) return tag;
    const tagName = tagNameMatch[1].toLowerCase();
    const resolvableAttrs = RESOLVABLE_TAG_ATTRS[tagName];
    const srcsetAttrs = SRCSET_TAG_ATTRS[tagName];
    if (!resolvableAttrs && !srcsetAttrs) return tag;
    return tag.replace(ATTR_ITER_RE, (...captures: unknown[]) => replaceAttrIfResolvable(captures, resolvableAttrs ?? [], srcsetAttrs ?? [], transform));
  });
}

function replaceAttrIfResolvable(
  captures: unknown[],
  resolvableAttrs: readonly string[],
  srcsetAttrs: readonly string[],
  transform: (url: string) => string | null,
): string {
  const [full, leading, name, eqWithSpaces, , doubleQuoted, singleQuoted, bare] = captures as [
    string,
    string,
    string,
    string | undefined,
    string | undefined,
    string | undefined,
    string | undefined,
    string | undefined,
  ];
  if (!eqWithSpaces) return full;
  const lowerName = name.toLowerCase();
  const isSrcset = srcsetAttrs.includes(lowerName);
  if (!isSrcset && !resolvableAttrs.includes(lowerName)) return full;
  const value = (doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
  if (!value) return full;
  const replacement = isSrcset ? rewriteSrcset(value, transform) : transform(value);
  // Single-URL: null means "leave verbatim". srcset: rewriteSrcset
  // always returns a string (per-candidate nulls handled inside),
  // and a no-op rewrite equal to the original is also left verbatim.
  if (replacement === null || replacement === value) return full;
  const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : '"';
  return `${leading}${name}${eqWithSpaces}${quote}${replacement}${quote}`;
}
