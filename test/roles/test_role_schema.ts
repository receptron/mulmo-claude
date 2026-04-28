import { describe, it } from "node:test";
import assert from "node:assert";
import { RoleSchema, BUILTIN_ROLES } from "../../src/config/roles.js";

describe("RoleSchema", () => {
  it("accepts a valid role with all fields", () => {
    const valid = {
      id: "test",
      name: "Test Role",
      icon: "star",
      prompt: "You are a test assistant.",
      availablePlugins: ["manageTodoList", "generateImage"],
      queries: ["hello"],
    };
    const result = RoleSchema.parse(valid);
    assert.deepStrictEqual(result, valid);
  });

  it("silently drops unknown plugin names from availablePlugins (lenient parse — #951)", () => {
    // Pre-#951 the schema rejected the whole role when it
    // referenced an unknown tool. That cost exceeded the typo-
    // catching benefit when a tool was removed in a later release
    // (e.g. `manageRoles` itself in #951): a legitimate role file
    // would silently disappear from `/roles` because
    // `loadCustomRoles` swallows zod failures. The schema now
    // filters the array instead so the role survives the load.
    const input = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: ["manageTodoList", "presentHTML", "generateImage"],
    };
    const result = RoleSchema.parse(input);
    assert.deepStrictEqual(result.availablePlugins, ["manageTodoList", "generateImage"]);
  });

  it("recovers a legacy role file that references the removed `manageRoles` tool (#951 regression guard)", () => {
    // Before #951 a role with `manageRoles` validated and the
    // role loaded; after #951 the tool name is gone from
    // TOOL_NAMES. Without lenient parsing the role would now
    // disappear from the list. Pin that the lenient parse keeps
    // it alive (dropping the dead reference but preserving every
    // other plugin).
    const legacyRole = {
      id: "my-role",
      name: "My Role",
      icon: "star",
      prompt: "prompt",
      availablePlugins: ["manageRoles", "manageTodoList", "generateImage"],
    };
    const result = RoleSchema.parse(legacyRole);
    assert.deepStrictEqual(result.availablePlugins, ["manageTodoList", "generateImage"]);
  });

  it("accepts a valid role without optional queries", () => {
    const valid = {
      id: "test",
      name: "Test Role",
      icon: "star",
      prompt: "You are a test assistant.",
      availablePlugins: [],
    };
    const result = RoleSchema.parse(valid);
    assert.strictEqual(result.queries, undefined);
  });

  it("rejects when id is missing", () => {
    const invalid = {
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when name is missing", () => {
    const invalid = {
      id: "test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when prompt is missing", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      availablePlugins: [],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when availablePlugins is missing", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when id is not a string", () => {
    const invalid = {
      id: 123,
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when availablePlugins contains non-string", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [123],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("rejects when queries contains non-string", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
      queries: [42],
    };
    assert.throws(() => RoleSchema.parse(invalid));
  });

  it("strips unknown properties", () => {
    const withExtra = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      availablePlugins: [],
      unknownField: "should be stripped",
    };
    const result = RoleSchema.parse(withExtra);
    assert.strictEqual("unknownField" in result, false, "unknown field should be stripped");
  });
});

describe("BUILTIN_ROLES", () => {
  it("all built-in roles pass schema validation", () => {
    BUILTIN_ROLES.forEach((role) => {
      assert.doesNotThrow(() => RoleSchema.parse(role), `Built-in role "${role.id}" failed validation`);
    });
  });

  it("all built-in roles have unique ids", () => {
    const ids = BUILTIN_ROLES.map((role) => role.id);
    const uniqueIds = new Set(ids);
    assert.strictEqual(ids.length, uniqueIds.size, "Role ids must be unique");
  });
});
