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

  it("rejects a role whose availablePlugins includes an unknown tool", () => {
    const invalid = {
      id: "test",
      name: "Test",
      icon: "star",
      prompt: "prompt",
      // `presentHTML` is the historical typo of `presentHtml`; the
      // enum-backed schema catches it at the boundary.
      availablePlugins: ["presentHTML"],
    };
    assert.throws(() => RoleSchema.parse(invalid));
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
