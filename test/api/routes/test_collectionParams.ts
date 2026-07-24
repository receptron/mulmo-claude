// The request-shape parsers behind the collection routes. Three of the four
// feed the view-data plane, which is a FROZEN public contract: LLM-authored
// HTML persisted in users' workspaces calls it and cannot be migrated
// centrally. So the edge behaviour here — what a blank entry does, whether
// whitespace survives — is not an implementation detail to tidy up later; it
// is the contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csvParam, extractRecord, parseCapabilities, parseListParam, stringParam } from "../../../server/api/routes/collectionParams.js";

describe("parseCapabilities", () => {
  it("keeps the known capabilities", () => {
    assert.deepEqual(parseCapabilities(["read", "write"]), ["read", "write"]);
    assert.deepEqual(parseCapabilities(["read"]), ["read"]);
  });

  // The result is clamped against what the view itself declares, so dropping
  // unknown entries can only ever narrow — never widen — what a token grants.
  it("drops unknown entries rather than rejecting the whole list", () => {
    assert.deepEqual(parseCapabilities(["read", "admin", "delete"]), ["read"]);
  });

  it("returns undefined when nothing recognisable survives", () => {
    assert.equal(parseCapabilities(["admin"]), undefined);
    assert.equal(parseCapabilities([]), undefined);
  });

  it("returns undefined for non-array input", () => {
    assert.equal(parseCapabilities("read"), undefined);
    assert.equal(parseCapabilities({ read: true }), undefined);
    assert.equal(parseCapabilities(undefined), undefined);
    assert.equal(parseCapabilities(null), undefined);
  });

  // Case matters: the token check compares exact strings.
  it("does not accept differently-cased capabilities", () => {
    assert.equal(parseCapabilities(["READ"]), undefined);
  });

  it("preserves duplicates rather than collapsing them", () => {
    assert.deepEqual(parseCapabilities(["read", "read"]), ["read", "read"]);
  });
});

describe("parseListParam", () => {
  it("splits a comma-separated string", () => {
    assert.deepEqual(parseListParam("a,b,c"), ["a", "b", "c"]);
  });

  it("accepts a repeated param as an array", () => {
    assert.deepEqual(parseListParam(["a", "b"]), ["a", "b"]);
  });

  it("trims each entry and drops blanks", () => {
    assert.deepEqual(parseListParam(" a , b ,, c "), ["a", "b", "c"]);
  });

  it("stringifies non-string array entries", () => {
    assert.deepEqual(parseListParam([1, 2]), ["1", "2"]);
  });

  it("returns undefined when nothing survives", () => {
    assert.equal(parseListParam(""), undefined);
    assert.equal(parseListParam("   "), undefined);
    assert.equal(parseListParam(",,"), undefined);
    assert.equal(parseListParam([]), undefined);
  });

  it("returns undefined for input that is neither string nor array", () => {
    assert.equal(parseListParam(undefined), undefined);
    assert.equal(parseListParam(null), undefined);
    assert.equal(parseListParam(7), undefined);
  });
});

describe("csvParam", () => {
  it("splits a comma-separated string", () => {
    assert.deepEqual(csvParam("a,b,c"), ["a", "b", "c"]);
  });

  // This is what separates it from `parseListParam`, and why the two must not
  // be merged: callers on the frozen contract receive entries verbatim.
  it("preserves whitespace and empty entries verbatim", () => {
    assert.deepEqual(csvParam(" a , b "), [" a ", " b "]);
    assert.deepEqual(csvParam("a,,b"), ["a", "", "b"]);
  });

  it("stringifies array entries without trimming", () => {
    assert.deepEqual(csvParam([" a ", 2]), [" a ", "2"]);
  });

  // An empty array is meaningful (an explicit empty selection), unlike an
  // empty string which means "not supplied".
  it("returns an empty array for an empty array, but undefined for an empty string", () => {
    assert.deepEqual(csvParam([]), []);
    assert.equal(csvParam(""), undefined);
  });

  it("returns undefined for input that is neither string nor array", () => {
    assert.equal(csvParam(undefined), undefined);
    assert.equal(csvParam(null), undefined);
    assert.equal(csvParam(7), undefined);
  });
});

describe("stringParam", () => {
  it("returns the value of a single-valued param verbatim", () => {
    assert.equal(stringParam("board"), "board");
    assert.equal(stringParam(" board "), " board "); // no trimming — the id is matched exactly
  });

  // A repeated param (`?id=a&id=b`) parses as an array. Stringifying it
  // would forge an id nobody asked for; "" lets the caller's 404 answer.
  it("reads a repeated param as absent", () => {
    assert.equal(stringParam(["a", "b"]), "");
    assert.equal(stringParam(["a"]), "");
  });

  it("reads a missing or non-string param as an empty string", () => {
    assert.equal(stringParam(undefined), "");
    assert.equal(stringParam(null), "");
    assert.equal(stringParam(7), "");
    assert.equal(stringParam({ id: "board" }), "");
  });

  it("preserves an explicitly empty value", () => {
    assert.equal(stringParam(""), "");
  });
});

describe("extractRecord", () => {
  it("accepts a plain object", () => {
    assert.deepEqual(extractRecord({ id: "a", name: "x" }), { id: "a", name: "x" });
  });

  it("accepts an empty object", () => {
    assert.deepEqual(extractRecord({}), {});
  });

  // An array passes a bare `typeof === "object"` check and would be written as
  // a record with numeric keys.
  it("rejects an array", () => {
    assert.equal(extractRecord([]), null);
    assert.equal(extractRecord([{ id: "a" }]), null);
  });

  it("rejects null, undefined and primitives", () => {
    assert.equal(extractRecord(null), null);
    assert.equal(extractRecord(undefined), null);
    assert.equal(extractRecord("record"), null);
    assert.equal(extractRecord(0), null);
    assert.equal(extractRecord(false), null);
  });
});
