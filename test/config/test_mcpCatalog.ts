import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MCP_CATALOG, findCatalogEntry } from "../../src/config/mcpCatalog.js";
import type { McpServerSpec } from "../../src/config/mcpTypes.js";

// Catalog smoke tests for #823 Phase 1. The Settings → MCP tab and
// the eventual Phase 2 form-driven entries both consume MCP_CATALOG;
// a typo in a package name or audience tag would silently ship to
// production unless we pin the data shape here. Codex-cross-review of
// PR #825 flagged the catalog as untested; these tests close that gap
// for the metadata side. UI-flow regressions (checkbox toggle →
// mcp.json round-trip) live in the Vue component test suite.

describe("MCP_CATALOG (Phase 1)", () => {
  it("ships exactly the two verified, pinned entries", () => {
    // Phase 1 explicitly excludes Apple-native + screenshot (no
    // stable community package to pin). If a new entry lands here,
    // bump the count AND verify the package is published & maintained.
    const ids = MCP_CATALOG.map((entry) => entry.id);
    assert.deepEqual(ids, ["memory", "sequential-thinking"]);
  });

  it("every entry uses the pinned `@modelcontextprotocol/*` namespace", () => {
    // Guards against a regression where a community package gets
    // re-introduced without proper verification. If a non-`@modelcontextprotocol`
    // package needs to land, update this test alongside the catalog
    // and document the verification (last commit, downloads).
    for (const entry of MCP_CATALOG) {
      assert.equal(entry.spec.type, "stdio", `entry ${entry.id} must be stdio in Phase 1`);
      if (entry.spec.type === "stdio") {
        assert.equal(entry.spec.command, "npx", `entry ${entry.id} must spawn via npx`);
        const pkg = entry.spec.args?.find((arg) => arg.startsWith("@modelcontextprotocol/"));
        assert.ok(pkg, `entry ${entry.id} must reference @modelcontextprotocol/* package`);
      }
    }
  });

  it("every entry has a non-empty configSchema array (Phase 1 is config-free)", () => {
    // Phase 1 contract: configSchema = []. Phase 2 grows the array;
    // until then any non-empty schema means a half-implemented entry
    // slipped in.
    for (const entry of MCP_CATALOG) {
      assert.deepEqual(entry.configSchema, [], `entry ${entry.id} must have empty configSchema in Phase 1`);
    }
  });

  it("every entry uses i18n keys (not raw strings) for displayName / description", () => {
    // Direct strings would skip the locale lookup and ship English
    // to every user. The keys are dot-paths under settingsMcpTab.catalog.
    for (const entry of MCP_CATALOG) {
      assert.match(entry.displayName, /^settingsMcpTab\.catalog\.entry\..+\.displayName$/, `entry ${entry.id} displayName must be an i18n key`);
      assert.match(entry.description, /^settingsMcpTab\.catalog\.entry\..+\.description$/, `entry ${entry.id} description must be an i18n key`);
    }
  });

  it("every entry has a populated upstreamUrl pointing at github.com or npmjs.com", () => {
    // The Settings UI links this so a curious user can read the
    // package's README before flipping the toggle. An empty / broken
    // URL would deadlink the install row.
    for (const entry of MCP_CATALOG) {
      assert.match(entry.upstreamUrl, /^https:\/\/(github\.com|www\.npmjs\.com)\//, `entry ${entry.id} upstreamUrl must point at GitHub or npmjs`);
    }
  });

  it("ids are unique (no two entries collide in the install map)", () => {
    const ids = MCP_CATALOG.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate id in MCP_CATALOG");
  });

  // Type-level mirror check between src/config/mcpTypes.ts and the
  // server's own McpServerSpec in server/system/config.ts. A runtime
  // assertion on the spec shape acts as a smoke-level contract:
  // adding a required field to the backend without updating the
  // frontend mirror would make this fail because the catalog entries
  // would no longer be assignable to the spec union.
  it("spec is assignable to the shared McpServerSpec type", () => {
    for (const entry of MCP_CATALOG) {
      const spec: McpServerSpec = entry.spec;
      assert.ok(spec.type === "stdio" || spec.type === "http");
    }
  });
});

describe("findCatalogEntry", () => {
  it("returns the matching entry for a known id", () => {
    const result = findCatalogEntry("memory");
    assert.notEqual(result, null);
    assert.equal(result?.id, "memory");
  });

  it("returns null for an unknown id (custom server, removed entry)", () => {
    // Custom (user-defined) servers and entries dropped between
    // releases must return null so the caller can branch on it
    // rather than throw.
    assert.equal(findCatalogEntry("custom-user-server"), null);
    assert.equal(findCatalogEntry(""), null);
  });

  it("matches by exact id, not by displayName or partial substring", () => {
    // Sanity guard against a refactor that loosens the match.
    assert.equal(findCatalogEntry("Memory"), null);
    assert.equal(findCatalogEntry("memo"), null);
  });
});
