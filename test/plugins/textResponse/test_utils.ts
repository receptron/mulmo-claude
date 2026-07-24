import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractTextResponseTitle, truncateForRender, RENDER_TRUNCATE_CHARS, RENDER_TRUNCATE_PREVIEW_CHARS } from "../../../src/plugins/textResponse/utils.js";

describe("extractTextResponseTitle", () => {
  it("returns the first H1 when present", () => {
    const text = "# Project plan\n\nSome body text here.";
    assert.equal(extractTextResponseTitle(text), "Project plan");
  });

  it("falls through to first non-empty line when no H1 exists", () => {
    const text = "Plain reply text\nsecond line";
    assert.equal(extractTextResponseTitle(text), "Plain reply text");
  });

  it("skips leading blank lines", () => {
    const text = "\n\n  \n  Real content\nnext";
    assert.equal(extractTextResponseTitle(text), "Real content");
  });

  it("truncates long H1 to 50 chars", () => {
    const long = "A".repeat(80);
    const text = `# ${long}`;
    const result = extractTextResponseTitle(text);
    assert.equal(result.length, 50);
    assert.equal(result, "A".repeat(50));
  });

  it("truncates long plain line to 50 chars", () => {
    const long = "B".repeat(80);
    const result = extractTextResponseTitle(long);
    assert.equal(result.length, 50);
    assert.equal(result, "B".repeat(50));
  });

  it("returns empty string for empty input", () => {
    assert.equal(extractTextResponseTitle(""), "");
  });

  it("returns empty string for whitespace-only input", () => {
    assert.equal(extractTextResponseTitle("   \n  \n\t"), "");
  });

  it("preserves unicode in the extracted title", () => {
    const text = "# プロジェクト概要\n\nbody";
    assert.equal(extractTextResponseTitle(text), "プロジェクト概要");
  });

  it("ignores H2 / H3 — only matches H1", () => {
    const text = "## Subhead\nFirst real line";
    assert.equal(extractTextResponseTitle(text), "## Subhead");
  });

  // Regression: "# install deps" inside a ```bash fence is a shell comment,
  // not a heading — it used to become the download filename.
  it("does not treat a '# ' line inside a code fence as the title", () => {
    const text = "```bash\n# install deps\nnpm i\n```\nHere is how to set up.";
    assert.equal(extractTextResponseTitle(text), "```bash");
  });

  it("still finds an H1 after a closed fence", () => {
    const text = "```\n# not a title\n```\n# Real title\nbody";
    assert.equal(extractTextResponseTitle(text), "Real title");
  });

  it("treats ~~~ fences like ``` fences", () => {
    const text = "~~~\n# not a title\n~~~\nplain lead";
    assert.equal(extractTextResponseTitle(text), "~~~");
  });

  it("ignores every '# ' line inside an unclosed fence (streaming partial)", () => {
    const text = "```python\n# comment one\n# comment two";
    assert.equal(extractTextResponseTitle(text), "```python");
  });
});

describe("truncateForRender", () => {
  it("holds the preview <= cap invariant so truncation math never overshoots", () => {
    assert.ok(
      RENDER_TRUNCATE_PREVIEW_CHARS <= RENDER_TRUNCATE_CHARS,
      `RENDER_TRUNCATE_PREVIEW_CHARS (${RENDER_TRUNCATE_PREVIEW_CHARS}) must be <= RENDER_TRUNCATE_CHARS (${RENDER_TRUNCATE_CHARS})`,
    );
  });

  it("returns the text unchanged when under the cap", () => {
    const text = "Normal reply.";
    const result = truncateForRender(text);
    assert.equal(result.wasTruncated, false);
    assert.equal(result.displayText, text);
    assert.equal(result.originalChars, text.length);
    assert.equal(result.omittedChars, 0);
  });

  it("passes through a payload exactly at the cap without truncating", () => {
    const text = "x".repeat(RENDER_TRUNCATE_CHARS);
    const result = truncateForRender(text);
    assert.equal(result.wasTruncated, false);
    assert.equal(result.displayText.length, RENDER_TRUNCATE_CHARS);
    assert.equal(result.omittedChars, 0);
  });

  it("truncates a runaway payload to the preview slice and reports the omission", () => {
    // Simulate an Opus 4.8 degenerate-repetition dump (#1863) —
    // 200k chars of blank-line-separated single words.
    const runaway = "court\n\n".repeat(30_000);
    const result = truncateForRender(runaway);
    assert.equal(result.wasTruncated, true);
    assert.equal(result.displayText.length, RENDER_TRUNCATE_PREVIEW_CHARS);
    assert.equal(result.originalChars, runaway.length);
    assert.equal(result.omittedChars, runaway.length - RENDER_TRUNCATE_PREVIEW_CHARS);
  });

  it("returns empty result for empty input", () => {
    const result = truncateForRender("");
    assert.equal(result.wasTruncated, false);
    assert.equal(result.displayText, "");
    assert.equal(result.originalChars, 0);
    assert.equal(result.omittedChars, 0);
  });

  // Regression: the code-unit slice used to cut an astral character in half,
  // leaving a lone high surrogate (renders as U+FFFD) at the preview tail.
  it("never ends the preview on a lone high surrogate", () => {
    // RENDER_TRUNCATE_PREVIEW_CHARS is even, so a pure surrogate-pair payload
    // slices cleanly — prefix one code unit to force the cut mid-pair.
    const emoji = "\u{1F600}";
    const misaligned = `x${emoji.repeat(RENDER_TRUNCATE_CHARS)}`;
    const result = truncateForRender(misaligned);
    assert.equal(result.wasTruncated, true);
    assert.ok(!/[\uD800-\uDBFF]$/.test(result.displayText), "preview must not end on a high surrogate");
    assert.equal(result.displayText.length, RENDER_TRUNCATE_PREVIEW_CHARS - 1);
    assert.equal(result.omittedChars, misaligned.length - result.displayText.length);
  });

  it("keeps a clean surrogate-pair boundary intact", () => {
    const emoji = "\u{1F600}";
    const aligned = emoji.repeat(RENDER_TRUNCATE_CHARS);
    const result = truncateForRender(aligned);
    assert.equal(result.wasTruncated, true);
    assert.equal(result.displayText.length, RENDER_TRUNCATE_PREVIEW_CHARS);
    assert.ok(!/[\uD800-\uDBFF]$/.test(result.displayText));
  });
});
