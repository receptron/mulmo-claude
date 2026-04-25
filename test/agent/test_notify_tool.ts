import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notify } from "../../server/agent/mcp-tools/notify.js";

// Note: `publishNotification` itself is fire-and-forget and gracefully
// handles uninitialized deps (logs a warn, no throw), so the handler
// can run in tests without any setup.

describe("notify MCP tool — input validation", () => {
  it("rejects an empty title", async () => {
    const result = await notify.handler({ title: "" });
    assert.match(result, /title.*required/i);
  });

  it("rejects a non-string title", async () => {
    const result = await notify.handler({ title: 123 });
    assert.match(result, /title.*required/i);
  });

  it("rejects a whitespace-only title", async () => {
    const result = await notify.handler({ title: "   " });
    assert.match(result, /title.*required/i);
  });
});

describe("notify MCP tool — happy path", () => {
  it("returns a confirmation including the title", async () => {
    const result = await notify.handler({ title: "Build done" });
    assert.match(result, /Notification sent: Build done/);
  });

  it("appends the body line when supplied", async () => {
    const result = await notify.handler({ title: "Build done", body: "All 12 steps green" });
    assert.equal(result, "Notification sent: Build done\nAll 12 steps green");
  });

  it("trims surrounding whitespace from title and body", async () => {
    const result = await notify.handler({ title: "  hi  ", body: "  there  " });
    assert.equal(result, "Notification sent: hi\nthere");
  });

  it("treats a whitespace-only body as missing", async () => {
    const result = await notify.handler({ title: "hi", body: "   " });
    assert.equal(result, "Notification sent: hi");
  });
});

describe("notify MCP tool — definition shape", () => {
  it("declares title as required and body as optional", () => {
    const schema = notify.definition.inputSchema as {
      properties: Record<string, unknown>;
      required: readonly string[];
    };
    assert.deepEqual(schema.required, ["title"]);
    assert.ok(schema.properties.title);
    assert.ok(schema.properties.body);
  });
});
