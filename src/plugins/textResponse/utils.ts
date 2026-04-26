// Plugin-specific helpers for textResponse. Kept separate from
// View.vue so the pure logic is easy to unit-test from node:test
// without needing a Vue runtime.

const MAX_TITLE_CHARS = 50;

// Pull a short, human-meaningful title out of a chat reply for use as
// a download filename. Priority:
//   1. First markdown H1 ("# ...") — the model often opens a long
//      reply with a heading; that's the cleanest signal.
//   2. First non-empty line, truncated.
//   3. Empty string when neither is available — caller decides the
//      fallback (the PDF filename builder uses "chat").
export function extractTextResponseTitle(text: string): string {
  let firstNonEmpty: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim().slice(0, MAX_TITLE_CHARS);
    }
    if (firstNonEmpty === null) firstNonEmpty = trimmed;
  }
  return (firstNonEmpty ?? "").slice(0, MAX_TITLE_CHARS);
}
