import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MCP_CATALOG, findCatalogEntry } from "../../src/config/mcpCatalog.js";
import type { McpServerSpec } from "../../src/config/mcpTypes.js";

// Catalog smoke tests for #823. Phase 1 (#825) shipped the two
// upstream-pinned entries; Phase 2 (#852) adds 6 community-packaged
// entries with `configSchema` form-driven setup. The Settings → MCP
// tab consumes MCP_CATALOG; a typo in a package name or audience
// tag would silently ship to production unless we pin the data
// shape here. UI-flow regressions (checkbox toggle → mcp.json
// round-trip) live in the Vue component test suite.

describe("MCP_CATALOG", () => {
  it("includes both Phase 1 upstream-pinned entries", () => {
    // memory and sequential-thinking are the only entries the
    // upstream Anthropic team owns directly. Any future repackaging
    // / rename has to land in the catalog deliberately, so freeze
    // the ids here.
    const ids = MCP_CATALOG.map((entry) => entry.id);
    assert.ok(ids.includes("memory"), "memory entry missing");
    assert.ok(ids.includes("sequential-thinking"), "sequential-thinking entry missing");
  });

  it("Phase 1 entries (`memory` / `sequential-thinking`) stay pinned to the @modelcontextprotocol/* namespace", () => {
    // Phase 2 adds community packages on purpose, so the namespace
    // pin only applies to the two upstream-owned entries — but it
    // must apply *strictly* to those: a regression that swaps
    // `@modelcontextprotocol/server-memory` for a community fork
    // would silently ship a different supply-chain dependency.
    const PHASE_1_IDS = new Set(["memory", "sequential-thinking"]);
    for (const entry of MCP_CATALOG) {
      if (!PHASE_1_IDS.has(entry.id)) continue;
      assert.equal(entry.spec.type, "stdio", `phase-1 entry ${entry.id} must be stdio`);
      if (entry.spec.type === "stdio") {
        assert.equal(entry.spec.command, "npx", `phase-1 entry ${entry.id} must spawn via npx`);
        const pkg = entry.spec.args?.find((arg) => arg.startsWith("@modelcontextprotocol/"));
        assert.ok(pkg, `phase-1 entry ${entry.id} must reference @modelcontextprotocol/* package`);
      }
    }
  });

  it("every entry has a runnable spec (stdio with command+args, or http with url)", () => {
    // Replaces the Phase-1-only "configSchema must be empty" check.
    // Phase 2 entries can carry configSchema, but the spec template
    // must always be invocable on its own (or with field
    // interpolation) — empty command / url here would ship a dead
    // checkbox.
    for (const entry of MCP_CATALOG) {
      if (entry.spec.type === "stdio") {
        assert.ok(entry.spec.command && entry.spec.command.length > 0, `entry ${entry.id} stdio command must be non-empty`);
        assert.ok(Array.isArray(entry.spec.args) && entry.spec.args.length > 0, `entry ${entry.id} stdio args must be non-empty`);
      } else {
        assert.ok(entry.spec.url && entry.spec.url.length > 0, `entry ${entry.id} http url must be non-empty`);
      }
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

  it("every entry has a populated upstreamUrl over https", () => {
    // The Settings UI links this so a curious user can read the
    // package's README before flipping the toggle. An empty URL
    // would deadlink the install row. Phase 2 introduces non-
    // github.com / non-npmjs domains (e.g. provider docs sites
    // like docs.devin.ai, open-meteo.com), so the check is just
    // "is it https" rather than a domain allow-list.
    for (const entry of MCP_CATALOG) {
      assert.match(entry.upstreamUrl, /^https:\/\/.+/, `entry ${entry.id} upstreamUrl must be a https:// URL`);
    }
  });

  it("ids are unique (no two entries collide in the install map)", () => {
    const ids = MCP_CATALOG.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate id in MCP_CATALOG");
  });

  it("configSchema fields use i18n keys for label, and helpText when present", () => {
    // Phase 2 contract: every form-field's user-visible string must
    // route through vue-i18n. A regression that hardcoded English
    // copy here would ship un-translatable strings in Settings.
    for (const entry of MCP_CATALOG) {
      for (const field of entry.configSchema) {
        assert.match(field.label, /^settingsMcpTab\.catalog\.entry\..+\.field\..+\.label$/, `entry ${entry.id} field ${field.key} label must be an i18n key`);
        if (field.helpText !== undefined) {
          assert.match(
            field.helpText,
            /^settingsMcpTab\.catalog\.entry\..+\.field\..+\.help$/,
            `entry ${entry.id} field ${field.key} helpText must be an i18n key`,
          );
        }
      }
    }
  });

  it("configSchema field keys are unique within an entry", () => {
    // Two fields with the same key would silently overwrite each
    // other when interpolating into the spec template.
    for (const entry of MCP_CATALOG) {
      const keys = entry.configSchema.map((field) => field.key);
      assert.equal(new Set(keys).size, keys.length, `entry ${entry.id} has duplicate field keys`);
    }
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
