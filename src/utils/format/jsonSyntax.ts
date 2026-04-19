// Tiny regex-based JSON tokenizer used by the Files-mode preview for
// syntax coloring. Keeps itself dependency-free so it can be reused
// and unit-tested without pulling in Vue or Tailwind.

export type JsonTokenType =
  | "key"
  | "string"
  | "number"
  | "keyword"
  | "punct"
  | "whitespace";

export interface JsonToken {
  type: JsonTokenType;
  value: string;
}

// Tailwind class for each token type. Kept alongside the tokenizer so
// callers that want colored output can just import and use it directly.
export const JSON_TOKEN_CLASS: Record<JsonTokenType, string> = {
  key: "text-blue-700",
  string: "text-green-700",
  number: "text-orange-600",
  keyword: "text-purple-700",
  punct: "text-gray-500",
  whitespace: "",
};

// Individually simple patterns combined by `nextToken` below. Keeping
// them separate avoids a single combined regex that trips
// sonarjs/regex-complexity and is easier to reason about.
const STRING_RE = /^"(?:[^"\\]|\\.)*"/;
const KEYWORD_RE = /^(?:true|false|null)\b/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const WS_RE = /^\s+/;
const PUNCT_RE = /^[{}[\]:,]/;

const MATCHERS: { type: JsonTokenType; re: RegExp }[] = [
  { type: "string", re: STRING_RE },
  { type: "keyword", re: KEYWORD_RE },
  { type: "number", re: NUMBER_RE },
  { type: "whitespace", re: WS_RE },
  { type: "punct", re: PUNCT_RE },
];

function nextToken(slice: string): JsonToken | null {
  for (const { type, re } of MATCHERS) {
    const m = re.exec(slice);
    if (m) return { type, value: m[0] };
  }
  return null;
}

export function tokenizeJson(raw: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let pos = 0;
  while (pos < raw.length) {
    const token = nextToken(raw.slice(pos));
    if (!token) {
      // Unknown char (syntax error / stray bytes). Emit verbatim so
      // the user still sees it, then advance one character.
      tokens.push({ type: "punct", value: raw[pos] });
      pos++;
      continue;
    }
    tokens.push(token);
    pos += token.value.length;
  }
  markKeys(tokens);
  return tokens;
}

// A string that precedes ":" (skipping whitespace) is an object key.
function markKeys(tokens: JsonToken[]): void {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "string") continue;
    let j = i + 1;
    while (j < tokens.length && tokens[j].type === "whitespace") j++;
    if (
      j < tokens.length &&
      tokens[j].type === "punct" &&
      tokens[j].value === ":"
    ) {
      tokens[i] = { type: "key", value: tokens[i].value };
    }
  }
}

// Pretty-print JSON with 2-space indentation, falling back to the raw
// source on parse error so the user can still read malformed files.
export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export interface JsonlLine {
  tokens: JsonToken[];
  parseError: boolean;
}

// Tokenize a JSON Lines document: one JSON value per non-empty line.
// Each parseable line is pretty-printed before tokenization so the
// output shows a readable multi-line record per entry. Malformed
// lines are tokenized as-is with `parseError: true` so the caller
// can mark them visually.
export function tokenizeJsonl(raw: string): JsonlLine[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line) => {
    try {
      const pretty = JSON.stringify(JSON.parse(line), null, 2);
      return { tokens: tokenizeJson(pretty), parseError: false };
    } catch {
      return { tokens: tokenizeJson(line), parseError: true };
    }
  });
}
