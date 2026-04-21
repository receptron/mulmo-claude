// Tolerant JSON extraction from Claude CLI text output. Claude
// often wraps JSON in a ```json fenced block or precedes it with
// conversational text. These helpers find and parse the first
// valid JSON object regardless of surrounding prose.
//
// Previously lived in workspace/journal/archivist.ts; moved here
// so any module that calls the Claude CLI can reuse them.

/**
 * Extract the first JSON object from a Claude CLI response.
 *
 * Strategy:
 *   1. Look for a ```json fenced block — most reliable when present.
 *   2. Fall back to the first balanced `{...}` block in the raw text.
 *   3. Return `null` if neither yields valid JSON.
 */
export function extractJsonObject(raw: string): unknown | null {
  const fencedBody = findFencedJsonBody(raw);
  if (fencedBody !== null) {
    try {
      return JSON.parse(fencedBody);
    } catch {
      // fall through to scan
    }
  }
  const balanced = findBalancedBraceBlock(raw);
  if (balanced === null) return null;
  try {
    return JSON.parse(balanced);
  } catch {
    return null;
  }
}

/**
 * Find the first balanced `{...}` substring, respecting JSON string
 * escapes. Uses a char-by-char scan (no regex) to avoid slow-regex
 * lint warnings and backtracking risks on large LLM output.
 */
export function findBalancedBraceBlock(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const char = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return raw.slice(start, i + 1);
  }
  return null;
}

/**
 * Extract the body of the first ` ```json ... ``` ` fenced block.
 * Returns `null` if no fenced block is found.
 */
export function findFencedJsonBody(raw: string): string | null {
  const OPEN = "```json";
  const CLOSE = "```";
  const openIdx = raw.indexOf(OPEN);
  if (openIdx === -1) return null;
  const afterOpen = openIdx + OPEN.length;
  const bodyStart = raw.indexOf("\n", afterOpen);
  if (bodyStart === -1) return null;
  const closeIdx = raw.indexOf(CLOSE, bodyStart + 1);
  if (closeIdx === -1) return null;
  const bodyEnd = raw[closeIdx - 1] === "\n" ? closeIdx - 1 : closeIdx;
  return raw.slice(bodyStart + 1, bodyEnd);
}
