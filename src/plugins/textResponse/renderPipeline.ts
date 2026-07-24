// Pure markdown pre-processing for the textResponse render path. Kept out
// of View.vue so the fence-awareness and JSON-detection rules can be
// unit-tested without a Vue runtime or a real `marked` — the inner
// renderer is injected.

const FENCE_LINE = /^\s*(```|~~~)/;

interface Segment {
  code: boolean;
  text: string;
}

// Split into alternating prose / fenced-code segments. Fence lines belong
// to the code segment. Segments join back with "\n" to reproduce the input
// exactly (every split point was a single newline).
export function splitFencedCode(text: string): Segment[] {
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let inCode = false;
  const flush = (code: boolean): void => {
    if (buffer.length > 0) {
      segments.push({ code, text: buffer.join("\n") });
      buffer = [];
    }
  };
  for (const line of text.split("\n")) {
    if (!FENCE_LINE.test(line)) {
      buffer.push(line);
      continue;
    }
    if (inCode) {
      buffer.push(line);
      flush(true);
      inCode = false;
    } else {
      flush(false);
      inCode = true;
      buffer.push(line);
    }
  }
  flush(inCode);
  return segments;
}

const THINK_BLOCK = /<think>([\s\S]*?)<\/think>/g;

// Grey out `<think>…</think>` reasoning — but never inside a fenced code
// block (there the tags are literal example text) and never across a fence
// boundary (each prose segment is matched independently). An unclosed
// `<think>` from a streaming partial is left untouched.
export function transformThinkBlocks(text: string, renderInner: (markdown: string) => string): string {
  return splitFencedCode(text)
    .map((segment) =>
      segment.code
        ? segment.text
        : segment.text.replace(THINK_BLOCK, (_match, content: string) => `<div class="think-block">${renderInner(content.trim())}</div>`),
    )
    .join("\n");
}

// A bare JSON object/array reads far better as a highlighted code block.
// Only wraps when the whole (trimmed) text parses — a partial dump stays
// as-is so a truncated tail doesn't throw.
export function wrapJsonAsCodeFence(text: string): string {
  const trimmed = text.trim();
  const looksLikeJson = (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksLikeJson) return text;
  try {
    JSON.parse(trimmed);
  } catch {
    return text;
  }
  return `\`\`\`json\n${trimmed}\n\`\`\``;
}
