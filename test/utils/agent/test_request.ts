// Unit tests for the pure request-body builder extracted from
// `src/App.vue#sendMessage`. See plans/done/refactor-vue-cognitive-complexity.md
// and issue #175.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgentRequestBody } from "../../../src/utils/agent/request.js";
import type { Role } from "../../../src/config/roles.js";

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "test-role",
    name: "Test Role",
    icon: "bolt",
    prompt: "",
    availablePlugins: [],
    ...overrides,
  };
}

describe("buildAgentRequestBody — happy path", () => {
  it("assembles every field in the shape the server expects", () => {
    const role = makeRole({
      id: "coder",
      availablePlugins: ["manageTodoList", "manageWiki"],
    });
    const body = buildAgentRequestBody({
      message: "hello",
      role,
      chatSessionId: "sess-1",
      selectedImageData: "data:image/png;base64,AAA",
    });
    // `userTimezone` depends on the host's Intl runtime, so only
    // assert shape on the fields we control directly and check the
    // timezone separately.
    const { userTimezone, ...rest } = body;
    assert.deepEqual(rest, {
      message: "hello",
      roleId: "coder",
      chatSessionId: "sess-1",
      selectedImageData: "data:image/png;base64,AAA",
    });
    // The builder must call Intl — node test runners always expose a
    // recognizable IANA id (even "UTC" in minimal builds). Guard with
    // a regex rather than a literal so the test isn't host-dependent.
    assert.ok(typeof userTimezone === "string" && userTimezone.length > 0, `expected a resolved timezone, got ${String(userTimezone)}`);
  });

  it("leaves selectedImageData as undefined when not provided", () => {
    const body = buildAgentRequestBody({
      message: "hi",
      role: makeRole(),
      chatSessionId: "s",
    });
    assert.equal(body.selectedImageData, undefined);
  });
});

describe("buildAgentRequestBody — edge cases", () => {
  it("accepts an empty message (sendMessage guards upstream; this helper doesn't)", () => {
    const body = buildAgentRequestBody({
      message: "",
      role: makeRole(),
      chatSessionId: "s",
    });
    assert.equal(body.message, "");
  });

  it("passes the role's id through regardless of role name/icon", () => {
    const role = makeRole({ id: "abc-123", name: "Name", icon: "bolt" });
    const body = buildAgentRequestBody({
      message: "m",
      role,
      chatSessionId: "s",
    });
    assert.equal(body.roleId, "abc-123");
  });
});
