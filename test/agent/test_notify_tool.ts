import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notify, makeNotifyTool, type NotifyPublishFn } from "../../server/agent/mcp-tools/notify.js";
import { NOTIFICATION_KINDS } from "../../src/types/notification.js";

// Capture each `publish` call so tests can assert on the args
// without firing the real publishNotification (which on darwin
// spawns osascript and adds a real entry to Reminders.app, #803).
function makeMockPublish(): { publish: NotifyPublishFn; calls: Parameters<NotifyPublishFn>[0][] } {
  const calls: Parameters<NotifyPublishFn>[0][] = [];
  const publish: NotifyPublishFn = (opts) => {
    calls.push(opts);
  };
  return { publish, calls };
}

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

  it("does NOT call publish when validation fails", async () => {
    const { publish, calls } = makeMockPublish();
    const tool = makeNotifyTool({ publish });
    await tool.handler({ title: "" });
    await tool.handler({ title: "   " });
    await tool.handler({ title: 42 });
    assert.equal(calls.length, 0);
  });
});

describe("notify MCP tool — happy path", () => {
  it("returns a confirmation including the title", async () => {
    const { publish, calls } = makeMockPublish();
    const tool = makeNotifyTool({ publish });
    const result = await tool.handler({ title: "Build done" });
    assert.match(result, /Notification sent: Build done/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].title, "Build done");
    assert.equal(calls[0].body, undefined);
    assert.equal(calls[0].kind, NOTIFICATION_KINDS.push);
  });

  it("appends the body line when supplied", async () => {
    const { publish, calls } = makeMockPublish();
    const tool = makeNotifyTool({ publish });
    const result = await tool.handler({ title: "Build done", body: "All 12 steps green" });
    assert.equal(result, "Notification sent: Build done\nAll 12 steps green");
    assert.equal(calls[0].body, "All 12 steps green");
  });

  it("trims surrounding whitespace from title and body", async () => {
    const { publish, calls } = makeMockPublish();
    const tool = makeNotifyTool({ publish });
    const result = await tool.handler({ title: "  hi  ", body: "  there  " });
    assert.equal(result, "Notification sent: hi\nthere");
    assert.equal(calls[0].title, "hi");
    assert.equal(calls[0].body, "there");
  });

  it("treats a whitespace-only body as missing", async () => {
    const { publish, calls } = makeMockPublish();
    const tool = makeNotifyTool({ publish });
    const result = await tool.handler({ title: "hi", body: "   " });
    assert.equal(result, "Notification sent: hi");
    assert.equal(calls[0].body, undefined);
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

  it("makeNotifyTool produces a definition matching the production singleton", () => {
    const { publish } = makeMockPublish();
    const tool = makeNotifyTool({ publish });
    assert.equal(tool.definition.name, notify.definition.name);
    assert.deepEqual(tool.definition.inputSchema, notify.definition.inputSchema);
  });
});
