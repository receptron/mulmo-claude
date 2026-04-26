import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpolateMcpSpec } from "../../../src/utils/mcp/interpolateSpec.js";
import type { McpServerSpec } from "../../../src/config/mcpTypes.js";

describe("interpolateMcpSpec — stdio", () => {
  it("substitutes ${VAR} in env values", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_API_KEY: "${NOTION_API_KEY}" },
    };
    const out = interpolateMcpSpec(template, { NOTION_API_KEY: "secret_abc" }, new Set(["NOTION_API_KEY"]));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.spec, {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_API_KEY: "secret_abc" },
    });
  });

  it("substitutes ${VAR} in args entries", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      args: ["-y", "some-server", "--token=${TOKEN}"],
    };
    const out = interpolateMcpSpec(template, { TOKEN: "xoxb-123" }, new Set(["TOKEN"]));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.spec.type === "stdio" ? out.spec.args : null, ["-y", "some-server", "--token=xoxb-123"]);
  });

  it("returns missing[] when a required key has no value", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { A: "${A}", B: "${B}" },
    };
    const out = interpolateMcpSpec(template, { A: "v" }, new Set(["A", "B"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing, ["B"]);
  });

  it("collects multiple missing required keys", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { A: "${A}", B: "${B}", C: "${C}" },
    };
    const out = interpolateMcpSpec(template, {}, new Set(["A", "B", "C"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing.sort(), ["A", "B", "C"]);
  });

  it("collapses optional placeholders to empty string when missing", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { OPTIONAL: "prefix-${OPT}" },
    };
    const out = interpolateMcpSpec(template, {}, new Set());
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.spec.type === "stdio" ? out.spec.env : null, { OPTIONAL: "prefix-" });
  });

  it("treats empty string the same as missing for required keys", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      env: { TOKEN: "${TOKEN}" },
    };
    const out = interpolateMcpSpec(template, { TOKEN: "" }, new Set(["TOKEN"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing, ["TOKEN"]);
  });
});

describe("interpolateMcpSpec — http", () => {
  it("substitutes ${VAR} in url and headers", () => {
    const template: McpServerSpec = {
      type: "http",
      url: "https://api.example.com/${REGION}/mcp",
      headers: { Authorization: "Bearer ${TOKEN}" },
    };
    const out = interpolateMcpSpec(template, { REGION: "us", TOKEN: "abc" }, new Set(["REGION", "TOKEN"]));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.spec, {
      type: "http",
      url: "https://api.example.com/us/mcp",
      headers: { Authorization: "Bearer abc" },
    });
  });

  it("returns missing[] for required url placeholder", () => {
    const template: McpServerSpec = { type: "http", url: "https://${HOST}/" };
    const out = interpolateMcpSpec(template, {}, new Set(["HOST"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing, ["HOST"]);
  });
});

describe("interpolateMcpSpec — passthrough", () => {
  it("preserves enabled flag when present", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      enabled: false,
    };
    const out = interpolateMcpSpec(template, {}, new Set());
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.spec.enabled, false);
  });

  it("does not invent fields when args/env are absent", () => {
    const template: McpServerSpec = { type: "stdio", command: "npx" };
    const out = interpolateMcpSpec(template, {}, new Set());
    assert.equal(out.ok, true);
    if (!out.ok) return;
    if (out.spec.type !== "stdio") {
      assert.fail("expected stdio");
      return;
    }
    assert.equal(out.spec.args, undefined);
    assert.equal(out.spec.env, undefined);
  });
});

describe("interpolateMcpSpec — required-key drift guard (Codex iter-1 #852)", () => {
  it("flags a required key that is never referenced in the template", () => {
    // Catalog-author mistake: form schema declares a required
    // NOTION_API_KEY field but the spec template forgot to consume
    // it (no `${NOTION_API_KEY}` anywhere). Pre-fix the install
    // succeeded silently and the user's value was simply discarded.
    // The fix flags the drift through the same missing-fields
    // error path the UI already renders.
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@example/notion-mcp"],
      // No env, no `${NOTION_API_KEY}` placeholder anywhere.
    };
    const out = interpolateMcpSpec(template, { NOTION_API_KEY: "secret_abc" }, new Set(["NOTION_API_KEY"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.deepEqual(out.missing, ["NOTION_API_KEY"]);
  });

  it("accepts a required key that IS referenced (happy path)", () => {
    const template: McpServerSpec = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@example/notion-mcp"],
      env: { NOTION_API_KEY: "${NOTION_API_KEY}" },
    };
    const out = interpolateMcpSpec(template, { NOTION_API_KEY: "secret_abc" }, new Set(["NOTION_API_KEY"]));
    assert.equal(out.ok, true);
    if (!out.ok) return;
    if (out.spec.type !== "stdio") return;
    assert.equal(out.spec.env?.NOTION_API_KEY, "secret_abc");
  });

  it("flags BOTH unreferenced-required AND empty-required at once", () => {
    // Spec references PORT but not API_KEY. User leaves PORT blank.
    // Both should surface in `missing` so the UI shows the catalog
    // drift AND the user oversight together — no progressive nag.
    const template: McpServerSpec = {
      type: "http",
      url: "https://example.test:${PORT}/mcp",
    };
    const out = interpolateMcpSpec(template, { PORT: "" }, new Set(["PORT", "API_KEY"]));
    assert.equal(out.ok, false);
    if (out.ok) return;
    const missingSet = new Set(out.missing);
    assert.equal(missingSet.has("PORT"), true);
    assert.equal(missingSet.has("API_KEY"), true);
  });

  it("does NOT flag optional keys that are never referenced", () => {
    // Optional placeholders may legitimately not appear in some
    // spec templates. The drift guard only fires for required keys.
    const template: McpServerSpec = { type: "stdio", command: "npx", args: ["-y", "x"] };
    const out = interpolateMcpSpec(template, {}, new Set());
    assert.equal(out.ok, true);
  });
});
