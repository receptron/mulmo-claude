import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROLES, BUILTIN_ROLE_IDS, DEFAULT_ROLE_ID } from "../../src/config/roles.ts";

// Guards that the literal-id map stays in sync with the actual
// ROLES array. If someone adds / renames a role in ROLES without
// updating BUILTIN_ROLE_IDS, these tests fail loudly.

describe("BUILTIN_ROLE_IDS", () => {
  it("has one entry per ROLES element", () => {
    const idsFromMap = Object.values(BUILTIN_ROLE_IDS).sort();
    const idsFromArray = ROLES.map((role) => role.id).sort();
    assert.deepEqual(idsFromMap, idsFromArray);
  });

  it("uses the same string for key and value (so refactors are obvious)", () => {
    for (const [key, value] of Object.entries(BUILTIN_ROLE_IDS)) {
      assert.equal(key, value, `BUILTIN_ROLE_IDS.${key} should equal "${key}", got "${value}"`);
    }
  });

  it("every BUILTIN_ROLE_IDS value resolves to an actual role via ROLES.find", () => {
    for (const roleId of Object.values(BUILTIN_ROLE_IDS)) {
      const role = ROLES.find((roleItem) => roleItem.id === roleId);
      assert.ok(role, `no role found for id "${roleId}"`);
    }
  });
});

describe("DEFAULT_ROLE_ID", () => {
  it("is one of the BUILTIN_ROLE_IDS values", () => {
    const ids = Object.values(BUILTIN_ROLE_IDS) as readonly string[];
    assert.ok(ids.includes(DEFAULT_ROLE_ID), `DEFAULT_ROLE_ID "${DEFAULT_ROLE_ID}" is not a builtin role id`);
  });

  it("resolves to an actual role", () => {
    const role = ROLES.find((roleItem) => roleItem.id === DEFAULT_ROLE_ID);
    assert.ok(role, "DEFAULT_ROLE_ID does not match any role in ROLES");
  });
});
