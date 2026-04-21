import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUserTextResponse, extractImageData, makeTextResult } from "../../../src/utils/tools/result.js";
import type { ToolResultComplete } from "gui-chat-protocol/vue";

function makeResult(over: Partial<ToolResultComplete>): ToolResultComplete {
  return {
    uuid: "u",
    toolName: "anything",
    message: "",
    title: "",
    data: undefined,
    ...over,
  } as ToolResultComplete;
}

describe("isUserTextResponse", () => {
  it("returns true for a user text-response", () => {
    const r = makeResult({
      toolName: "text-response",
      data: { text: "hi", role: "user", transportKind: "text-rest" },
    });
    assert.equal(isUserTextResponse(r), true);
  });

  it("returns false for an assistant text-response", () => {
    const r = makeResult({
      toolName: "text-response",
      data: { text: "hi", role: "assistant", transportKind: "text-rest" },
    });
    assert.equal(isUserTextResponse(r), false);
  });

  it("returns false for non text-response tool names", () => {
    const r = makeResult({
      toolName: "manageScheduler",
      data: { role: "user" },
    });
    assert.equal(isUserTextResponse(r), false);
  });

  it("returns false when data is missing", () => {
    const r = makeResult({ toolName: "text-response", data: undefined });
    assert.equal(isUserTextResponse(r), false);
  });

  it("returns false when data is null", () => {
    const r = makeResult({ toolName: "text-response", data: null });
    assert.equal(isUserTextResponse(r), false);
  });

  it("returns false when data has no role property", () => {
    const r = makeResult({
      toolName: "text-response",
      data: { text: "hi" },
    });
    assert.equal(isUserTextResponse(r), false);
  });
});

describe("extractImageData", () => {
  it("returns the imageData string when present", () => {
    const r = makeResult({ data: { imageData: "BASE64..." } });
    assert.equal(extractImageData(r), "BASE64...");
  });

  it("returns undefined when imageData is missing", () => {
    assert.equal(extractImageData(makeResult({ data: { foo: "bar" } })), undefined);
  });

  it("returns undefined when imageData is not a string", () => {
    const r = makeResult({ data: { imageData: 42 } });
    assert.equal(extractImageData(r), undefined);
  });

  it("returns undefined when result is undefined", () => {
    assert.equal(extractImageData(undefined), undefined);
  });

  it("returns undefined when data is null", () => {
    assert.equal(extractImageData(makeResult({ data: null })), undefined);
  });
});

describe("makeTextResult", () => {
  it("creates a user text-response", () => {
    const r = makeTextResult("hello", "user");
    assert.equal(r.toolName, "text-response");
    assert.equal(r.message, "hello");
    assert.equal(r.title, "You");
    assert.deepEqual(r.data, {
      text: "hello",
      role: "user",
      transportKind: "text-rest",
    });
    // uuidv4 strings are 36 chars with dashes
    assert.match(r.uuid, /^[0-9a-f-]{36}$/);
  });

  it("creates an assistant text-response", () => {
    const r = makeTextResult("hi back", "assistant");
    assert.equal(r.title, "Assistant");
    const data = r.data as { role: string };
    assert.equal(data.role, "assistant");
  });

  it("generates a fresh uuid each call", () => {
    const a = makeTextResult("x", "user");
    const b = makeTextResult("x", "user");
    assert.notEqual(a.uuid, b.uuid);
  });
});
