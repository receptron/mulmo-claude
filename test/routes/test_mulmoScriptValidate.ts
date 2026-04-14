import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateUpdateBeatBody,
  validateUpdateScriptBody,
} from "../../server/routes/mulmoScriptValidate.ts";

// Minimal script / beat objects that satisfy the zod schemas from
// `@mulmocast/types`. If `@mulmocast/types` tightens its schemas, the
// exact shape below may need updating — use a schema diff to sync.
const VALID_BEAT = {
  speaker: "Narrator",
  text: "Beat one.",
  image: {
    type: "textSlide",
    slide: { title: "Slide 1", bullets: ["one"] },
  },
};

const VALID_SCRIPT = {
  $mulmocast: { version: "1.1" },
  title: "Test",
  description: "A test script",
  lang: "en",
  beats: [VALID_BEAT],
  imageParams: {},
};

describe("validateUpdateScriptBody", () => {
  it("accepts a valid body and returns the parsed value", () => {
    const out = validateUpdateScriptBody({
      filePath: "stories/x.json",
      script: VALID_SCRIPT,
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.value.filePath, "stories/x.json");
      assert.ok(out.value.script);
    }
  });

  it("rejects a null body", () => {
    const out = validateUpdateScriptBody(null);
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /object/);
  });

  it("rejects a primitive body", () => {
    assert.equal(validateUpdateScriptBody("oops").ok, false);
    assert.equal(validateUpdateScriptBody(42).ok, false);
    assert.equal(validateUpdateScriptBody(true).ok, false);
  });

  it("rejects a body missing filePath", () => {
    const out = validateUpdateScriptBody({ script: VALID_SCRIPT });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /filePath/);
  });

  it("rejects a body with empty-string filePath", () => {
    const out = validateUpdateScriptBody({
      filePath: "",
      script: VALID_SCRIPT,
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /filePath/);
  });

  it("rejects a body missing script", () => {
    const out = validateUpdateScriptBody({ filePath: "stories/x.json" });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /script is required/);
  });

  it("rejects a body whose script is not schema-conformant", () => {
    const out = validateUpdateScriptBody({
      filePath: "stories/x.json",
      script: { completelyBogus: true },
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /invalid script/);
  });

  it("rejects a garbage JSON blob entirely", () => {
    const out = validateUpdateScriptBody({
      filePath: "stories/x.json",
      script: "not-an-object",
    });
    assert.equal(out.ok, false);
  });
});

describe("validateUpdateBeatBody", () => {
  it("accepts a valid body", () => {
    const out = validateUpdateBeatBody({
      filePath: "stories/x.json",
      beatIndex: 0,
      beat: VALID_BEAT,
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.value.beatIndex, 0);
      assert.ok(out.value.beat);
    }
  });

  it("rejects a negative beatIndex", () => {
    const out = validateUpdateBeatBody({
      filePath: "stories/x.json",
      beatIndex: -1,
      beat: VALID_BEAT,
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /beatIndex/);
  });

  it("rejects a non-integer beatIndex", () => {
    const out = validateUpdateBeatBody({
      filePath: "stories/x.json",
      beatIndex: 1.5,
      beat: VALID_BEAT,
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /beatIndex/);
  });

  it("rejects a string beatIndex", () => {
    const out = validateUpdateBeatBody({
      filePath: "stories/x.json",
      beatIndex: "0",
      beat: VALID_BEAT,
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /beatIndex/);
  });

  it("rejects a body missing beat", () => {
    const out = validateUpdateBeatBody({
      filePath: "stories/x.json",
      beatIndex: 0,
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /beat is required/);
  });

  it("rejects a body whose beat is not schema-conformant", () => {
    const out = validateUpdateBeatBody({
      filePath: "stories/x.json",
      beatIndex: 0,
      beat: { completelyBogus: true },
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /invalid beat/);
  });

  it("rejects null / primitive bodies", () => {
    assert.equal(validateUpdateBeatBody(null).ok, false);
    assert.equal(validateUpdateBeatBody("oops").ok, false);
    assert.equal(validateUpdateBeatBody(42).ok, false);
  });
});
