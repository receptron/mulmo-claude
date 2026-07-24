// Tolerant extraction of a JSON object out of an LLM reply, shared by
// the memory classifier and the topic clusterer (#2336). Claude
// occasionally wraps the payload in a code fence or prefixes a word
// despite the prompt banning both, so the raw text is never safe to
// hand straight to `JSON.parse`.

export function stripFenceAndWhitespace(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    const firstNl = text.indexOf("\n");
    if (firstNl >= 0) text = text.slice(firstNl + 1);
    if (text.endsWith("```")) text = text.slice(0, -3);
  }
  return text.trim();
}

export function extractFirstObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index = skipStringBody(text, index + 1);
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
    index += 1;
  }
  return null;
}

// Returns the index immediately after the closing `"`, or `text.length`
// if the string is unterminated. Backslash escapes the next char so
// `\"` does not close the string.
export function skipStringBody(text: string, fromIndex: number): number {
  let index = fromIndex;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') return index + 1;
    index += 1;
  }
  return text.length;
}
