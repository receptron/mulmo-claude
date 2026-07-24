// Unit tests for the pure id helpers (packages/core/src/collection/core/ids.ts).
// Focus: `generateUniqueId`'s collision re-roll (the logic lifted out of the
// view's `generateUniqueItemId`); the slug/record-id validators are exercised
// via schema tests already.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateUniqueId } from "@mulmoclaude/core/collection";

/** A deterministic generator returning the given ids in order, then repeating
 *  the last one forever — models `shortHexId` for a fixed roll sequence. */
function sequence(...ids: string[]): () => string {
  let index = 0;
  return () => {
    const picked = ids[Math.min(index, ids.length - 1)];
    index++;
    return picked;
  };
}

describe("generateUniqueId", () => {
  it("returns the first candidate when nothing collides", () => {
    assert.equal(generateUniqueId(new Set(), sequence("a", "b")), "a");
  });

  it("returns the first candidate when it is free even if the set is non-empty", () => {
    assert.equal(generateUniqueId(new Set(["x", "y"]), sequence("a")), "a");
  });

  it("re-rolls past colliding candidates to the first free one", () => {
    const gen = sequence("dup1", "dup2", "free");
    assert.equal(generateUniqueId(new Set(["dup1", "dup2"]), gen), "free");
  });

  it("stops re-rolling as soon as a free id appears (no extra calls)", () => {
    let calls = 0;
    const gen = (): string => {
      calls++;
      return calls === 1 ? "dup" : "free";
    };
    assert.equal(generateUniqueId(new Set(["dup"]), gen), "free");
    assert.equal(calls, 2);
  });

  it("gives up after maxAttempts re-rolls and returns the last candidate (caller's overwrite guard is the backstop)", () => {
    let calls = 0;
    const gen = (): string => {
      calls++;
      return "always";
    };
    // Every candidate collides; with the default 8 re-rolls that is 1 initial
    // roll + 8 retries = 9 generate calls, and the (still-colliding) value is
    // returned rather than looping forever.
    assert.equal(generateUniqueId(new Set(["always"]), gen), "always");
    assert.equal(calls, 9);
  });

  it("honours a custom maxAttempts", () => {
    let calls = 0;
    const gen = (): string => {
      calls++;
      return "always";
    };
    generateUniqueId(new Set(["always"]), gen, 2);
    assert.equal(calls, 3); // 1 initial + 2 retries
  });
});
