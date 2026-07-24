import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateEntryList, type EntryListSpec } from "../../server/utils/validateEntryList.ts";
import { hasStringProp } from "../../server/utils/types.ts";

// A stand-in for a workspace config entry: valid when `name` is a string
// starting with "ok". The parser trims, so a test can tell the parser's
// output apart from the raw input item.
interface Widget {
  name: string;
}

function parseWidget(item: unknown): Widget | null {
  if (!hasStringProp(item, "name")) return null;
  const name = item.name.trim();
  return name.startsWith("ok") ? { name } : null;
}

const MAX = 3;

function widgetSpec(maxEntries = MAX): EntryListSpec<Widget, "name"> {
  return {
    maxEntries,
    validateEntry: parseWidget,
    echoProp: "name",
    describeInvalid: (name) => `invalid name "${name}"`,
  };
}

function validate(raw: unknown, maxEntries = MAX) {
  return validateEntryList(raw, widgetSpec(maxEntries));
}

function okItems(count: number): unknown[] {
  return Array.from({ length: count }, (_unused, i) => ({ name: `ok-${i}` }));
}

describe("validateEntryList — input shape", () => {
  it("rejects a non-array", () => {
    assert.deepEqual(validate("data/notes"), { error: "expected an array" });
  });

  it("rejects null", () => {
    assert.deepEqual(validate(null), { error: "expected an array" });
  });

  it("rejects undefined", () => {
    assert.deepEqual(validate(undefined), { error: "expected an array" });
  });

  it("rejects a plain object", () => {
    assert.deepEqual(validate({ 0: { name: "ok-a" }, length: 1 }), { error: "expected an array" });
  });

  it("accepts an empty array as an empty entry list", () => {
    assert.deepEqual(validate([]), { entries: [] });
  });
});

describe("validateEntryList — entry cap", () => {
  it("accepts exactly maxEntries", () => {
    const result = validate(okItems(MAX));
    assert.ok(!("error" in result), `expected ${MAX} entries to pass the cap, got: ${JSON.stringify(result)}`);
    assert.equal(result.entries.length, MAX);
  });

  it("rejects maxEntries + 1 before validating any entry", () => {
    assert.deepEqual(validate(okItems(MAX + 1)), { error: `too many entries (max ${MAX})` });
  });

  it("reports the cap it was given, not a shared constant", () => {
    assert.deepEqual(validate(okItems(21), 20), { error: "too many entries (max 20)" });
  });

  it("counts raw items, not valid ones, against the cap", () => {
    const overCap = [...okItems(MAX), { name: "nope" }];
    assert.deepEqual(validate(overCap), { error: `too many entries (max ${MAX})` });
  });
});

describe("validateEntryList — per-entry errors", () => {
  it("reports every invalid entry, joined", () => {
    const result = validate([{ name: "bad-a" }, { name: "bad-b" }]);
    assert.deepEqual(result, { error: 'entry 0: invalid name "bad-a"; entry 1: invalid name "bad-b"' });
  });

  it("numbers entries by position in the raw array, not by error count", () => {
    const result = validate([{ name: "ok-a" }, { name: "bad" }]);
    assert.deepEqual(result, { error: 'entry 1: invalid name "bad"' });
  });

  it("fails the whole list when any entry is invalid", () => {
    const result = validate([{ name: "ok-a" }, { name: "bad" }]);
    assert.ok("error" in result);
  });

  it("echoes an empty string rather than [object Object] for a non-string property", () => {
    const result = validate([{ name: { nested: true } }]);
    assert.deepEqual(result, { error: 'entry 0: invalid name ""' });
    assert.ok("error" in result);
    assert.doesNotMatch(result.error, /\[object Object\]/);
  });

  it("echoes an empty string rather than [object Object] for an array property", () => {
    const result = validate([{ name: ["data/notes"] }]);
    assert.ok("error" in result);
    assert.doesNotMatch(result.error, /\[object Object\]/);
  });

  it("echoes an empty string when the property is missing entirely", () => {
    assert.deepEqual(validate([{}]), { error: 'entry 0: invalid name ""' });
  });

  it("survives a null item without throwing", () => {
    assert.deepEqual(validate([null]), { error: 'entry 0: invalid name ""' });
  });

  it("survives a primitive item without throwing", () => {
    assert.deepEqual(validate([42]), { error: 'entry 0: invalid name ""' });
  });
});

describe("validateEntryList — valid list", () => {
  it("passes a valid list through in order", () => {
    const result = validate([{ name: "ok-a" }, { name: "ok-b" }]);
    assert.deepEqual(result, { entries: [{ name: "ok-a" }, { name: "ok-b" }] });
  });

  it("returns the parser's output, not the raw items", () => {
    const result = validate([{ name: "  ok-a  ", extra: "dropped" }]);
    assert.deepEqual(result, { entries: [{ name: "ok-a" }] });
  });
});
