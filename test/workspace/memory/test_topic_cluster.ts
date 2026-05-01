// Unit tests for the LLM-cluster output parser (#1070 PR-A).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseClusterMap } from "../../../server/workspace/memory/topic-cluster.js";

describe("memory/topic-cluster — parseClusterMap", () => {
  it("parses a clean JSON cluster map", () => {
    const raw = JSON.stringify({
      preference: [{ topic: "dev", unsectionedBullets: ["yarn"] }],
      interest: [{ topic: "music", sections: [{ heading: "Rock", bullets: ["Pantera"] }] }],
      fact: [],
      reference: [],
    });
    const out = parseClusterMap(raw);
    assert.ok(out !== null);
    assert.equal(out.preference.length, 1);
    assert.equal(out.preference[0].topic, "dev");
    assert.deepEqual(out.preference[0].unsectionedBullets, ["yarn"]);
    assert.equal(out.interest.length, 1);
    assert.equal(out.interest[0].sections?.[0].heading, "Rock");
  });

  it("strips a leading code fence", () => {
    const raw = '```json\n{"preference":[{"topic":"dev","unsectionedBullets":["yarn"]}],"interest":[],"fact":[],"reference":[]}\n```';
    const out = parseClusterMap(raw);
    assert.ok(out !== null);
    assert.equal(out.preference.length, 1);
  });

  it("recovers from leading prose", () => {
    const raw = 'Sure: {"preference":[{"topic":"dev","unsectionedBullets":["yarn"]}],"interest":[],"fact":[],"reference":[]}';
    const out = parseClusterMap(raw);
    assert.ok(out !== null);
    assert.equal(out.preference.length, 1);
  });

  it("returns null on malformed JSON", () => {
    assert.equal(parseClusterMap('{"preference":[,'), null);
    assert.equal(parseClusterMap("not json"), null);
    assert.equal(parseClusterMap(""), null);
  });

  it("drops topics with no bullets and no sections", () => {
    const raw = JSON.stringify({
      preference: [{ topic: "dev" }, { topic: "real", unsectionedBullets: ["yarn"] }],
      interest: [],
      fact: [],
      reference: [],
    });
    const out = parseClusterMap(raw);
    assert.ok(out !== null);
    assert.equal(out.preference.length, 1);
    assert.equal(out.preference[0].topic, "real");
  });

  it("normalises an unsafe topic name via slugify", () => {
    const raw = JSON.stringify({
      preference: [{ topic: "AI Research Papers!", unsectionedBullets: ["one"] }],
      interest: [],
      fact: [],
      reference: [],
    });
    const out = parseClusterMap(raw);
    assert.ok(out !== null);
    assert.equal(out.preference[0].topic, "ai-research-papers");
  });

  it("drops topics whose name slugs to nothing safe", () => {
    const raw = JSON.stringify({
      preference: [{ topic: "...", unsectionedBullets: ["one"] }],
      interest: [],
      fact: [],
      reference: [],
    });
    const out = parseClusterMap(raw);
    assert.ok(out !== null);
    assert.equal(out.preference.length, 0);
  });
});
