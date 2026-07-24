// Plugin-specific helpers for textResponse. Kept separate from
// View.vue so the pure logic is easy to unit-test from node:test
// without needing a Vue runtime.

const MAX_TITLE_CHARS = 50;

// Cap on how much of an assistant message we feed into marked() at once.
// The Opus 4.8 "degenerate repetition" bug can generate hundreds of
// thousands of chars of blank-line-separated single words; marked itself
// parses that fine (~120ms), but Safari's layout/paint on ~30k <p>
// elements freezes the tab for minutes (#1863). 100_000 is comfortably
// larger than any real assistant reply (Claude's ~200k token ceiling is
// well below that in bytes) and small enough that pathological input
// bounces off it well before the render blows up.
export const RENDER_TRUNCATE_CHARS = 100_000;
// The preview slice we DO render when a message trips the cap. Small
// enough that even a fully-blank-line-separated payload stays under a
// few thousand block elements. Users get "Copy" for the full raw text.
export const RENDER_TRUNCATE_PREVIEW_CHARS = 20_000;

export interface TruncationResult {
  displayText: string;
  wasTruncated: boolean;
  originalChars: number;
  omittedChars: number;
}

// A code-unit slice can end on the high half of a surrogate pair — the
// tail then renders as U+FFFD and a lone surrogate leaks into marked /
// clipboard paths. Drop the dangling half instead.
function sliceWithoutDanglingSurrogate(text: string, length: number): string {
  const sliced = text.slice(0, length);
  return /[\uD800-\uDBFF]$/.test(sliced) ? sliced.slice(0, -1) : sliced;
}

// Truncate an assistant message so pathological model output can't
// freeze the render path. Pure so it can be unit-tested from
// node:test without a Vue runtime.
export function truncateForRender(text: string): TruncationResult {
  const originalChars = text.length;
  if (originalChars <= RENDER_TRUNCATE_CHARS) {
    return { displayText: text, wasTruncated: false, originalChars, omittedChars: 0 };
  }
  const displayText = sliceWithoutDanglingSurrogate(text, RENDER_TRUNCATE_PREVIEW_CHARS);
  return {
    displayText,
    wasTruncated: true,
    originalChars,
    omittedChars: originalChars - displayText.length,
  };
}

// Pull a short, human-meaningful title out of a chat reply for use as
// a download filename. Priority:
//   1. First markdown H1 ("# ...") — the model often opens a long
//      reply with a heading; that's the cleanest signal.
//   2. First non-empty line, truncated.
//   3. Empty string when neither is available — caller decides the
//      fallback (the PDF filename builder uses "chat").
export function extractTextResponseTitle(text: string): string {
  let firstNonEmpty: string | null = null;
  let insideFence = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // A "# ..." line inside a fenced block is a shell/Python comment, not a
    // heading — "```bash\n# install deps\n```" must not name the download.
    if (/^(```|~~~)/.test(trimmed)) {
      insideFence = !insideFence;
      if (firstNonEmpty === null) firstNonEmpty = trimmed;
      continue;
    }
    if (!insideFence && trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim().slice(0, MAX_TITLE_CHARS);
    }
    if (firstNonEmpty === null) firstNonEmpty = trimmed;
  }
  return (firstNonEmpty ?? "").slice(0, MAX_TITLE_CHARS);
}
