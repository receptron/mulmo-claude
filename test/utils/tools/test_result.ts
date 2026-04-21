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
    const toolResult = makeResult({
      toolName: "text-response",
      data: { text: "hi", role: "user", transportKind: "text-rest" },
    });
    assert.equal(isUserTextResponse(toolResult), true);
  });

  it("returns false for an assistant text-response", () => {
    const toolResult = makeResult({
      toolName: "text-response",
      data: { text: "hi", role: "assistant", transportKind: "text-rest" },
    });
    assert.equal(isUserTextResponse(toolResult), false);
  });

  it("returns false for non text-response tool names", () => {
    const toolResult = makeResult({
      toolName: "manageScheduler",
      data: { role: "user" },
    });
    assert.equal(isUserTextResponse(toolResult), false);
  });

  it("returns false when data is missing", () => {
    const toolResult = makeResult({ toolName: "text-response", data: undefined });
    assert.equal(isUserTextResponse(toolResult), false);
  });

  it("returns false when data is null", () => {
    const toolResult = makeResult({ toolName: "text-response", data: null });
    assert.equal(isUserTextResponse(toolResult), false);
  });

  it("returns false when data has no role property", () => {
    const toolResult = makeResult({
      toolName: "text-response",
      data: { text: "hi" },
    });
    assert.equal(isUserTextResponse(toolResult), false);
  });
});

describe("extractImageData", () => {
  it("returns the imageData string when present", () => {
    const toolResult = makeResult({ data: { imageData: "BASE64..." } });
    assert.equal(extractImageData(toolResult), "BASE64...");
  });

  it("returns undefined when imageData is missing", () => {
    assert.equal(extractImageData(makeResult({ data: { foo: "bar" } })), undefined);
  });

  it("returns undefined when imageData is not a string", () => {
    const toolResult = makeResult({ data: { imageData: 42 } });
    assert.equal(extractImageData(toolResult), undefined);
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
    const result = makeTextResult("hello", "user");
    assert.equal(result.toolName, "text-response");
    assert.equal(result.message, "hello");
    assert.equal(result.title, "You");
    assert.deepEqual(result.data, {
      text: "hello",
      role: "user",
      transportKind: "text-rest",
    });
    // uuidv4 strings are 36 chars with dashes
    assert.match(result.uuid, /^[0-9a-f-]{36}$/);
  });

  it("creates an assistant text-response", () => {
    const result = makeTextResult("hi back", "assistant");
    assert.equal(result.title, "Assistant");
    const data = result.data as { role: string };
    assert.equal(data.role, "assistant");
  });

  it("generates a fresh uuid each call", () => {
    const result1 = makeTextResult("x", "user");
    const result2 = makeTextResult("x", "user");
    assert.notEqual(result1.uuid, result2.uuid);
  });
});
