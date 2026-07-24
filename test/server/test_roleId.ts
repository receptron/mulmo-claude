import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidRoleId } from "../../server/utils/files/roleId.js";

describe("isValidRoleId", () => {
  it("accepts alphanumerics, dash and underscore", () => {
    assert.equal(isValidRoleId("engineer"), true);
    assert.equal(isValidRoleId("my_role-2"), true);
  });

  // The agent/tool path supplies role.id verbatim; these must be rejected
  // before the id becomes `<id>.json` via path.join.
  it("rejects path-traversal payloads", () => {
    assert.equal(isValidRoleId("../../../../tmp/evil"), false);
    assert.equal(isValidRoleId("../x"), false);
    assert.equal(isValidRoleId("a/b"), false);
    assert.equal(isValidRoleId("a.json"), false);
  });

  it("rejects empty and non-string input", () => {
    assert.equal(isValidRoleId(""), false);
    assert.equal(isValidRoleId(undefined), false);
    assert.equal(isValidRoleId(null), false);
    assert.equal(isValidRoleId(42), false);
  });

  it("rejects whitespace and special characters", () => {
    assert.equal(isValidRoleId("a b"), false);
    assert.equal(isValidRoleId("role!"), false);
    assert.equal(isValidRoleId("__proto__"), true);
  });
});
