import { describe, it } from "node:test";
import assert from "node:assert/strict";

// We can't import the actual module (CF Workers types), so test
// the pure logic by inlining the registry pattern.

describe("PlatformPlugin registry", () => {
  it("registers and retrieves plugins by path", () => {
    const plugins = new Map<string, { name: string; webhookPath: string }>();
    const register = (plugin: { name: string; webhookPath: string }) => plugins.set(plugin.webhookPath, plugin);
    const getByPath = (path: string) => plugins.get(path);

    register({ name: "line", webhookPath: "/webhook/line" });
    register({ name: "telegram", webhookPath: "/webhook/telegram" });

    assert.equal(getByPath("/webhook/line")?.name, "line");
    assert.equal(getByPath("/webhook/telegram")?.name, "telegram");
    assert.equal(getByPath("/webhook/slack"), undefined);
  });

  it("retrieves plugins by name", () => {
    const plugins = new Map<string, { name: string; webhookPath: string }>();
    const register = (plugin: { name: string; webhookPath: string }) => plugins.set(plugin.webhookPath, plugin);
    const getByName = (name: string) => {
      for (const plugin of plugins.values()) {
        if (plugin.name === name) return plugin;
      }
      return undefined;
    };

    register({ name: "line", webhookPath: "/webhook/line" });
    assert.equal(getByName("line")?.webhookPath, "/webhook/line");
    assert.equal(getByName("discord"), undefined);
  });
});
