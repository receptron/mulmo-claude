import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { updateSkillDescription, removeSkillByName } from "../../../src/plugins/manageSkills/skillListEdits.js";
import type { SkillSummary } from "../../../src/plugins/manageSkills/index.js";

const make = (name: string, description = ""): SkillSummary => ({ name, description }) as SkillSummary;

describe("updateSkillDescription", () => {
  it("replaces only the matching skill's description", () => {
    const input = [make("a", "old-a"), make("b", "old-b")];
    const out = updateSkillDescription(input, "b", "new-b");
    assert.equal(out[1].description, "new-b");
    assert.equal(out[0].description, "old-a");
  });

  it("does not mutate the input array or its objects", () => {
    const input = [make("a", "old-a")];
    const out = updateSkillDescription(input, "a", "new-a");
    assert.notEqual(out, input);
    assert.equal(input[0].description, "old-a", "original object untouched");
  });

  it("returns an equivalent list when the name is absent", () => {
    const input = [make("a"), make("b")];
    assert.deepEqual(updateSkillDescription(input, "missing", "x"), input);
  });

  it("is case-sensitive", () => {
    const input = [make("Foo", "orig")];
    assert.equal(updateSkillDescription(input, "foo", "changed")[0].description, "orig");
  });

  it("handles an empty list", () => {
    assert.deepEqual(updateSkillDescription([], "a", "x"), []);
  });
});

describe("removeSkillByName", () => {
  it("removes the matching skill and preserves order", () => {
    const input = [make("a"), make("b"), make("c")];
    assert.deepEqual(
      removeSkillByName(input, "b").map((skill) => skill.name),
      ["a", "c"],
    );
  });

  it("does not mutate the input array", () => {
    const input = [make("a"), make("b")];
    const out = removeSkillByName(input, "a");
    assert.notEqual(out, input);
    assert.equal(input.length, 2, "original length preserved");
  });

  it("returns an equivalent list when the name is absent", () => {
    const input = [make("a")];
    assert.deepEqual(removeSkillByName(input, "missing"), input);
  });

  it("removes every entry sharing the name", () => {
    const input = [make("dup"), make("keep"), make("dup")];
    assert.deepEqual(
      removeSkillByName(input, "dup").map((skill) => skill.name),
      ["keep"],
    );
  });

  it("handles an empty list", () => {
    assert.deepEqual(removeSkillByName([], "a"), []);
  });
});
