import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errorMessage } from "../../server/utils/errors.js";

describe("errorMessage", () => {
  it("returns .message for an Error instance", () => {
    assert.equal(errorMessage(new Error("boom")), "boom");
  });

  it("returns .message for a subclass of Error", () => {
    class CustomError extends Error {}
    assert.equal(errorMessage(new CustomError("specific")), "specific");
  });

  it("returns the string for a plain string", () => {
    assert.equal(errorMessage("oops"), "oops");
  });

  it("returns 'null' for null", () => {
    assert.equal(errorMessage(null), "null");
  });

  it("returns 'undefined' for undefined", () => {
    assert.equal(errorMessage(undefined), "undefined");
  });

  it("returns numeric string for a number", () => {
    assert.equal(errorMessage(42), "42");
  });

  it("returns '[object Object]' for a plain object without toString", () => {
    // String() on a plain object falls through to Object.prototype.toString,
    // which produces "[object Object]". We don't unwrap .message because
    // an arbitrary object that happens to have a `message` field is not
    // necessarily an Error and could be misleading.
    assert.equal(errorMessage({ message: "trick" }), "[object Object]");
  });

  it("returns the empty string for an empty Error message", () => {
    assert.equal(errorMessage(new Error("")), "");
  });
});
