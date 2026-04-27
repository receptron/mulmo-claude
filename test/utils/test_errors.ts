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

  it("unwraps .details from a gRPC-style error object", () => {
    // Real-world case: TTS/voice clients throw `{ code, details, metadata }`
    // which is not an Error instance. Without unwrapping `.details`, users
    // would see "[object Object]" instead of the actual cause.
    assert.equal(errorMessage({ code: 3, details: "voice needs model" }), "voice needs model");
  });

  it("unwraps .message from a non-Error object", () => {
    assert.equal(errorMessage({ message: "boom" }), "boom");
  });

  it("prefers .details over .message when both are present", () => {
    assert.equal(errorMessage({ details: "specific", message: "generic" }), "specific");
  });

  it("falls through to String(err) when .details and .message are not strings", () => {
    assert.equal(errorMessage({ details: 42 }), "[object Object]");
  });

  it("falls through to String(err) when .details and .message are empty", () => {
    assert.equal(errorMessage({ details: "", message: "" }), "[object Object]");
  });

  it("returns the empty string for an empty Error message", () => {
    assert.equal(errorMessage(new Error("")), "");
  });
});
