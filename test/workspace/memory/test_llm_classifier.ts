// Unit tests for the LLM-backed memory classifier (#1029 PR-B).
//
// These cover the parser used to interpret Claude's verdict — both
// the happy path and the formatting drift we expect in practice
// (code fences, leading prose, markdown wrappers). The actual
// summarize callback is stubbed so no Claude CLI is needed.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { makeLlmMemoryClassifier, parseClassifierVerdict } from "../../../server/workspace/memory/llm-classifier.js";
import type { MemoryCandidate } from "../../../server/workspace/memory/migrate.js";

describe("memory/llm-classifier — parseClassifierVerdict", () => {
  it("parses a clean JSON verdict", () => {
    const out = parseClassifierVerdict('{"type":"preference","description":"uses yarn"}');
    assert.deepEqual(out, { type: "preference", description: "uses yarn" });
  });

  it("strips a leading code fence and trailing one", () => {
    const wrapped = '```json\n{"type":"interest","description":"AI papers"}\n```';
    const out = parseClassifierVerdict(wrapped);
    assert.deepEqual(out, { type: "interest", description: "AI papers" });
  });

  it("recovers the JSON object from leading prose the prompt told the LLM not to add", () => {
    const noisy = 'Sure! Here you go: {"type":"fact","description":"planning Egypt trip"} — let me know if you need more.';
    const out = parseClassifierVerdict(noisy);
    assert.deepEqual(out, { type: "fact", description: "planning Egypt trip" });
  });

  it("returns null when the LLM emits a literal `null`", () => {
    assert.equal(parseClassifierVerdict("null"), null);
    assert.equal(parseClassifierVerdict("\n  null  \n"), null);
  });

  it("returns null when the type is missing or unknown", () => {
    assert.equal(parseClassifierVerdict('{"description":"no type"}'), null);
    assert.equal(parseClassifierVerdict('{"type":"weird","description":"x"}'), null);
  });

  it("accepts a verdict without a description", () => {
    const out = parseClassifierVerdict('{"type":"reference"}');
    assert.deepEqual(out, { type: "reference" });
  });

  it("normalises whitespace and caps description length", () => {
    const long = "x".repeat(500);
    const out = parseClassifierVerdict(`{"type":"fact","description":"line\\nbreak  ${long}"}`);
    assert.ok(out !== null);
    assert.equal(out.type, "fact");
    assert.ok((out.description ?? "").length <= 200);
    assert.ok(!(out.description ?? "").includes("\n"));
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseClassifierVerdict('{"type":"fact",,'), null);
    assert.equal(parseClassifierVerdict("not json at all"), null);
    assert.equal(parseClassifierVerdict(""), null);
  });
});

describe("memory/llm-classifier — makeLlmMemoryClassifier", () => {
  let summarized: { system: string; user: string }[];

  before(() => {
    summarized = [];
  });

  after(() => {
    summarized = [];
  });

  it("invokes the supplied summarize callback with the candidate body", async () => {
    const classifier = makeLlmMemoryClassifier({
      summarize: async (system, user) => {
        summarized.push({ system, user });
        return '{"type":"preference","description":"yarn only"}';
      },
    });
    const candidate: MemoryCandidate = { section: "Preferences", body: "yarn を使う" };
    const verdict = await classifier(candidate);
    assert.deepEqual(verdict, { type: "preference", description: "yarn only" });
    assert.equal(summarized.length, 1);
    assert.match(summarized[0].user, /yarn を使う/);
    assert.match(summarized[0].user, /Preferences/);
    assert.match(summarized[0].system, /preference/);
  });

  it("returns null when the summarize callback throws", async () => {
    const classifier = makeLlmMemoryClassifier({
      summarize: async () => {
        throw new Error("boom");
      },
    });
    const verdict = await classifier({ section: "", body: "anything" });
    assert.equal(verdict, null);
  });

  it("returns null when the LLM emits garbage", async () => {
    const classifier = makeLlmMemoryClassifier({
      summarize: async () => "I refuse.",
    });
    const verdict = await classifier({ section: "", body: "anything" });
    assert.equal(verdict, null);
  });
});
