import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { frameText } from "../src/index.ts";

describe("frameText", () => {
  it("decodes a Buffer as utf8", () => {
    assert.equal(frameText(Buffer.from("héllo", "utf8")), "héllo");
  });

  it("concatenates a Buffer[] fragment list", () => {
    assert.equal(frameText([Buffer.from("ab"), Buffer.from("cd")]), "abcd");
  });

  it("decodes an ArrayBuffer (not via its garbage toString)", () => {
    const source = Buffer.from("frame", "utf8");
    const ab = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    assert.equal(frameText(ab), "frame");
    // Regression: a naive `String(arrayBuffer)` would be "[object ArrayBuffer]".
    assert.notEqual(frameText(ab), "[object ArrayBuffer]");
  });

  it("handles an empty frame", () => {
    assert.equal(frameText(Buffer.from("")), "");
    assert.equal(frameText([]), "");
  });
});
