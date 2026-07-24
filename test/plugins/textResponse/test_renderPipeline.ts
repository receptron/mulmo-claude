import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitFencedCode, transformThinkBlocks, wrapJsonAsCodeFence } from "../../../src/plugins/textResponse/renderPipeline.js";

// Marker so tests can see exactly what the inner renderer received.
const echoInner = (markdown: string): string => `[R:${markdown}]`;

describe("splitFencedCode", () => {
  it("returns a single prose segment when there is no fence", () => {
    assert.deepEqual(splitFencedCode("a\nb"), [{ code: false, text: "a\nb" }]);
  });

  it("round-trips to the original text when segments rejoin with newline", () => {
    const input = "a\n```\ncode\n```\nb";
    const rejoined = splitFencedCode(input)
      .map((segment) => segment.text)
      .join("\n");
    assert.equal(rejoined, input);
  });

  it("marks the fenced block (including fence lines) as code", () => {
    const segs = splitFencedCode("intro\n```js\nx()\n```\nend");
    assert.deepEqual(segs, [
      { code: false, text: "intro" },
      { code: true, text: "```js\nx()\n```" },
      { code: false, text: "end" },
    ]);
  });

  it("treats an unclosed fence as code to the end", () => {
    const segs = splitFencedCode("intro\n```\nstill open");
    assert.deepEqual(segs, [
      { code: false, text: "intro" },
      { code: true, text: "```\nstill open" },
    ]);
  });
});

describe("transformThinkBlocks", () => {
  it("wraps a think block in a think-block div using the inner renderer", () => {
    assert.equal(transformThinkBlocks("<think>reasoning</think>", echoInner), '<div class="think-block">[R:reasoning]</div>');
  });

  it("trims the think content before rendering", () => {
    assert.equal(transformThinkBlocks("<think>\n  hi  \n</think>", echoInner), '<div class="think-block">[R:hi]</div>');
  });

  // Regression: a <think> example inside a code fence must stay literal.
  it("does not transform think tags inside a fenced code block", () => {
    const input = "```\n<think>hidden</think>\n```";
    assert.equal(transformThinkBlocks(input, echoInner), input);
  });

  it("does not match a think block that spans across a fence boundary", () => {
    const input = "<think>a\n```\ncode\n```\nb</think>";
    // Each prose segment is matched independently, so the unclosed halves
    // on either side of the fence stay literal.
    assert.ok(!transformThinkBlocks(input, echoInner).includes("think-block"));
  });

  it("leaves an unclosed think tag untouched (streaming partial)", () => {
    assert.equal(transformThinkBlocks("<think>partial reasoning", echoInner), "<think>partial reasoning");
  });

  it("transforms multiple think blocks", () => {
    const out = transformThinkBlocks("<think>one</think>\n<think>two</think>", echoInner);
    assert.equal(out.match(/think-block/g)?.length, 2);
  });
});

describe("wrapJsonAsCodeFence", () => {
  it("wraps a valid JSON object", () => {
    assert.equal(wrapJsonAsCodeFence('{"a":1}'), '```json\n{"a":1}\n```');
  });

  it("wraps a valid JSON array", () => {
    assert.equal(wrapJsonAsCodeFence("[1, 2]"), "```json\n[1, 2]\n```");
  });

  it("trims surrounding whitespace before wrapping", () => {
    assert.equal(wrapJsonAsCodeFence('  {"a":1}  '), '```json\n{"a":1}\n```');
  });

  it("leaves invalid JSON alone", () => {
    assert.equal(wrapJsonAsCodeFence("{not json}"), "{not json}");
  });

  it("leaves prose that merely starts with a brace alone", () => {
    assert.equal(wrapJsonAsCodeFence("{ this is a note"), "{ this is a note");
  });

  it("leaves plain text alone", () => {
    assert.equal(wrapJsonAsCodeFence("Hello world"), "Hello world");
  });

  it("leaves an empty string alone", () => {
    assert.equal(wrapJsonAsCodeFence(""), "");
  });
});
