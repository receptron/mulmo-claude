import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyDevModeFilter } from "../../src/composables/useRoles.ts";
import { ROLES, BUILTIN_ROLE_IDS, type Role } from "../../src/config/roles.ts";

describe("applyDevModeFilter", () => {
  it("hides the Debug role when devMode is false", () => {
    const filtered = applyDevModeFilter(ROLES, false);
    const ids = filtered.map((role) => role.id);
    assert.ok(!ids.includes(BUILTIN_ROLE_IDS.debug), `Debug role leaked into the dropdown when devMode=false: ${ids.join(", ")}`);
  });

  it("includes the Debug role when devMode is true", () => {
    const filtered = applyDevModeFilter(ROLES, true);
    const ids = filtered.map((role) => role.id);
    assert.ok(ids.includes(BUILTIN_ROLE_IDS.debug), `Debug role missing when devMode=true: ${ids.join(", ")}`);
  });

  it("keeps every non-debug role intact when devMode is false", () => {
    const filtered = applyDevModeFilter(ROLES, false);
    const expected = ROLES.filter((role) => role.id !== BUILTIN_ROLE_IDS.debug).map((role) => role.id);
    assert.deepEqual(
      filtered.map((role) => role.id),
      expected,
    );
  });

  it("does not mutate the input array", () => {
    const snapshot: Role[] = [...ROLES];
    applyDevModeFilter(ROLES, false);
    assert.deepEqual(ROLES, snapshot, "input was mutated");
  });
});
