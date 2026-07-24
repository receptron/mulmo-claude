import { test } from "node:test";
import assert from "node:assert/strict";

import { errorMessage } from "../src/index.ts";

test("errorMessage: Error instance surfaces its message", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage(new TypeError("bad type")), "bad type");
});

test("errorMessage: { message } object surfaces the message field", () => {
  assert.equal(errorMessage({ message: "plain message" }), "plain message");
});

test("errorMessage: { details } object surfaces the details field (gRPC shape)", () => {
  assert.equal(errorMessage({ code: 8, details: "quota exceeded" }), "quota exceeded");
});

test("errorMessage: details takes precedence over message", () => {
  // Deliberate ordering: gRPC errors carry both `message` (generic) and
  // `details` (specific); the specific one is more useful.
  assert.equal(errorMessage({ details: "specific", message: "generic" }), "specific");
});

test("errorMessage: empty-string details/message fall through, not returned", () => {
  // Empty fields must NOT short-circuit to "" — they fall through to message,
  // then fallback, then String(err).
  assert.equal(errorMessage({ details: "", message: "real" }), "real");
  assert.equal(errorMessage({ details: "", message: "" }, "fb"), "fb");
});

test("errorMessage: plain string is stringified", () => {
  assert.equal(errorMessage("just a string"), "just a string");
});

test("errorMessage: number is stringified", () => {
  assert.equal(errorMessage(42), "42");
});

test("errorMessage: null and undefined stringify (no crash on property read)", () => {
  assert.equal(errorMessage(null), "null");
  assert.equal(errorMessage(undefined), "undefined");
});

test("errorMessage: fallback used for non-Error values, ignored for Errors", () => {
  assert.equal(errorMessage(null, "rebuild failed"), "rebuild failed");
  assert.equal(errorMessage({ code: 1 }, "rebuild failed"), "rebuild failed");
  assert.equal(errorMessage(new Error("boom"), "rebuild failed"), "boom");
});

test("errorMessage: non-string details/message ignored, fall through", () => {
  assert.equal(errorMessage({ details: 500 }, "fb"), "fb");
  assert.equal(errorMessage({ message: { nested: true } }, "fb"), "fb");
});

test("errorMessage: an array is not treated as an error-like object (deliberate — arrays fall through, not read for a stray .message)", () => {
  // The old `typeof err === "object"` branch would have returned a string
  // `.message`/`.details` set on an array; `isRecord` excludes arrays, so an
  // array now falls through like any non-record. Realistic thrown values
  // (Error / gRPC-style {details} / {message}) are unaffected; only the
  // pathological `Object.assign([], { message })` differs, intentionally.
  const arrayWithMessage = Object.assign([], { message: "stray" });
  assert.equal(errorMessage(arrayWithMessage, "fb"), "fb");
  assert.equal(errorMessage([1, 2, 3]), "1,2,3");
});
