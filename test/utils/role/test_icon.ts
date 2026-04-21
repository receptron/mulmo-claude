import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roleIcon, roleName } from "../../../src/utils/role/icon.js";
import type { Role } from "../../../src/config/roles";

const roles: Role[] = [
  {
    id: "general",
    name: "General",
    icon: "star",
    prompt: "",
    availablePlugins: [],
  },
  {
    id: "tutor",
    name: "Tutor",
    icon: "school",
    prompt: "",
    availablePlugins: [],
  },
  {
    id: "broken",
    name: "Broken",
    icon: "🤖", // emoji, not a Material Icon name
    prompt: "",
    availablePlugins: [],
  },
];

describe("roleIcon", () => {
  it("returns the role's icon when it is a valid Material Icon name", () => {
    assert.equal(roleIcon(roles, "general"), "star");
    assert.equal(roleIcon(roles, "tutor"), "school");
  });

  it("falls back to smart_toy when the icon contains non-letter chars", () => {
    assert.equal(roleIcon(roles, "broken"), "smart_toy");
  });

  it("falls back to star when the role is unknown", () => {
    assert.equal(roleIcon(roles, "no-such-role"), "star");
  });

  it("accepts only lowercase letters and underscores as valid icons", () => {
    const testRoles: Role[] = [
      {
        id: "a",
        name: "",
        icon: "valid_name",
        prompt: "",
        availablePlugins: [],
      },
      {
        id: "b",
        name: "",
        icon: "Has_Caps",
        prompt: "",
        availablePlugins: [],
      },
      {
        id: "c",
        name: "",
        icon: "with-dash",
        prompt: "",
        availablePlugins: [],
      },
      {
        id: "d",
        name: "",
        icon: "123",
        prompt: "",
        availablePlugins: [],
      },
    ];
    assert.equal(roleIcon(testRoles, "a"), "valid_name");
    assert.equal(roleIcon(testRoles, "b"), "smart_toy");
    assert.equal(roleIcon(testRoles, "c"), "smart_toy");
    assert.equal(roleIcon(testRoles, "d"), "smart_toy");
  });
});

describe("roleName", () => {
  it("returns the role's display name", () => {
    assert.equal(roleName(roles, "general"), "General");
    assert.equal(roleName(roles, "tutor"), "Tutor");
  });

  it("falls back to the id when the role is unknown", () => {
    assert.equal(roleName(roles, "phantom"), "phantom");
  });
});
