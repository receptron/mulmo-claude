// The readers that pull a file path / command / tool name / session id out of
// the PostToolUse payload Claude CLI streams on stdin.
//
// They are defensive by design: every one returns a benign default rather than
// throwing, because a hook that crashes takes the user's tool turn with it.
// That is also why they need tests — a wrong default is indistinguishable from
// a correct one at runtime. The hook just quietly does nothing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCommand, extractFilePath, extractSessionId, extractToolName, type HookPayload } from "../../../server/workspace/hooks/shared/stdin.js";

describe("extractFilePath", () => {
  it("reads tool_input.file_path, which Write and Edit populate", () => {
    assert.equal(extractFilePath({ tool_input: { file_path: "notes.md" } }), "notes.md");
  });

  // The response shape uses a different key; handlers should not have to know
  // which tool they are downstream of.
  it("falls back to tool_response.filePath", () => {
    assert.equal(extractFilePath({ tool_response: { filePath: "notes.md" } }), "notes.md");
  });

  it("prefers tool_input over tool_response when both are present", () => {
    assert.equal(extractFilePath({ tool_input: { file_path: "from-input.md" }, tool_response: { filePath: "from-response.md" } }), "from-input.md");
  });

  // An empty string is the "nothing to do" signal, so a non-string value must
  // land there rather than being stringified into a bogus path.
  it("returns an empty string for a missing or non-string path", () => {
    assert.equal(extractFilePath({}), "");
    assert.equal(extractFilePath({ tool_input: {} }), "");
    assert.equal(extractFilePath({ tool_input: { file_path: 7 } }), "");
    assert.equal(extractFilePath({ tool_input: { file_path: null } }), "");
    assert.equal(extractFilePath({ tool_response: { filePath: ["notes.md"] } }), "");
  });

  // A non-string in tool_input must not stop the tool_response fallback.
  it("falls through to the response when tool_input carries a non-string", () => {
    assert.equal(extractFilePath({ tool_input: { file_path: 7 }, tool_response: { filePath: "notes.md" } }), "notes.md");
  });
});

describe("extractCommand", () => {
  it("reads the Bash command string", () => {
    assert.equal(extractCommand({ tool_input: { command: "ls -la" } }), "ls -la");
  });

  it("returns an empty string for a non-Bash or malformed payload", () => {
    assert.equal(extractCommand({}), "");
    assert.equal(extractCommand({ tool_input: {} }), "");
    assert.equal(extractCommand({ tool_input: { command: 7 } }), "");
    assert.equal(extractCommand({ tool_input: { file_path: "notes.md" } }), "");
  });

  // An empty command is a real (if useless) value, and must round-trip as one
  // rather than being conflated with "absent".
  it("passes an empty command through unchanged", () => {
    assert.equal(extractCommand({ tool_input: { command: "" } }), "");
  });
});

describe("extractToolName", () => {
  it("reads a string tool name", () => {
    assert.equal(extractToolName({ tool_name: "Bash" }), "Bash");
  });

  it("returns an empty string when absent or not a string", () => {
    assert.equal(extractToolName({}), "");
    assert.equal(extractToolName({ tool_name: 7 }), "");
    assert.equal(extractToolName({ tool_name: null }), "");
  });

  // Dispatchers compare this by exact string, so case must survive verbatim.
  it("does not normalise case", () => {
    assert.equal(extractToolName({ tool_name: "bash" }), "bash");
  });
});

describe("extractSessionId", () => {
  it("reads a non-empty session id", () => {
    assert.equal(extractSessionId({ session_id: "abc-123" }), "abc-123");
  });

  // Unlike the others this returns `undefined`, not `""` — callers branch on
  // presence, and an empty-string id would be treated as a real one.
  it("returns undefined for absent, empty and non-string ids", () => {
    assert.equal(extractSessionId({}), undefined);
    assert.equal(extractSessionId({ session_id: "" }), undefined);
    assert.equal(extractSessionId({ session_id: 7 }), undefined);
    assert.equal(extractSessionId({ session_id: null }), undefined);
  });
});

describe("hook payload extractors — hostile shapes", () => {
  // The dispatcher hands these whatever `JSON.parse` produced. A crash here
  // takes down the user's tool turn, so every one must degrade instead.
  it("survives payloads whose nested fields are the wrong type", () => {
    const hostile: HookPayload[] = [
      { tool_input: null } as unknown as HookPayload,
      { tool_input: "string" } as unknown as HookPayload,
      { tool_input: [] } as unknown as HookPayload,
      { tool_response: 7 } as unknown as HookPayload,
    ];
    for (const payload of hostile) {
      assert.equal(extractFilePath(payload), "");
      assert.equal(extractCommand(payload), "");
    }
  });

  // `JSON.parse` makes `__proto__` an OWN data property rather than setting the
  // prototype, so a payload written this way simply has no tool_name.
  it("treats a JSON-parsed __proto__ key as an ordinary absent field", () => {
    const payload = JSON.parse('{"__proto__": {"tool_name": "Bash", "session_id": "hijacked"}}') as HookPayload;
    assert.equal(extractToolName(payload), "");
    assert.equal(extractSessionId(payload), undefined);
  });
});
