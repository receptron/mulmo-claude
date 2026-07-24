// Tiny dot/bracket path resolver used by the declarative `ingest.map`
// and `ingest.itemsAt`. Pure, no I/O, exhaustively unit-testable.
//
// Supported syntax:
//   "title"                → root.title
//   "data.name"            → root.data.name
//   "results[0].id"        → root.results[0].id
//   "hourly[]"             → root.hourly        (trailing [] = "the array
//                            here"; the marker is a no-op for value reads)
//   "data.results[]"       → root.data.results
//
// Any miss (wrong type, out-of-range index, absent key) yields
// `undefined` rather than throwing — declarative configs fail soft.

interface KeyToken {
  kind: "key";
  key: string;
}
interface IndexToken {
  kind: "index";
  index: number;
}
type PathToken = KeyToken | IndexToken;

const BRACKET_RE = /\[(\d*)\]/g;

/** Split one dot-segment (`results[0]`, `hourly[]`, `name`) into tokens.
 *  An empty `[]` is an array-identity marker and emits no token — the
 *  array value is read by the preceding key. */
function parseSegment(segment: string, tokens: PathToken[]): void {
  const bracketStart = segment.indexOf("[");
  const name = bracketStart === -1 ? segment : segment.slice(0, bracketStart);
  if (name.length > 0) tokens.push({ kind: "key", key: name });
  if (bracketStart === -1) return;
  for (const match of segment.slice(bracketStart).matchAll(BRACKET_RE)) {
    const [, inner] = match;
    if (inner.length > 0) tokens.push({ kind: "index", index: Number(inner) });
  }
}

function tokenize(path: string): PathToken[] {
  const tokens: PathToken[] = [];
  for (const segment of path.split(".")) {
    if (segment.length > 0) parseSegment(segment, tokens);
  }
  return tokens;
}

function step(current: unknown, token: PathToken): unknown {
  if (current === null || current === undefined) return undefined;
  if (token.kind === "key") {
    if (typeof current !== "object" || Array.isArray(current)) return undefined;
    const record = current as Record<string, unknown>;
    // A `__proto__` / `constructor` / `toString` key must miss (→ undefined),
    // not read an inherited Object.prototype member into a `naturalKey`.
    return Object.hasOwn(record, token.key) ? record[token.key] : undefined;
  }
  return Array.isArray(current) ? current[token.index] : undefined;
}

/** Resolve a dot/bracket path against `root`, or `undefined` on any miss. */
export function getByPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const token of tokenize(path)) {
    current = step(current, token);
  }
  return current;
}

/** Locate the array of raw items for a fetch. With `itemsAt` set, walk
 *  to it; without it, the response itself must be the array. Non-arrays
 *  yield `[]` so a malformed response is a no-op, not a crash. */
export function getItemsArray(root: unknown, itemsAt: string | undefined): unknown[] {
  if (!itemsAt) return Array.isArray(root) ? root : [];
  const value = getByPath(root, itemsAt);
  return Array.isArray(value) ? value : [];
}
