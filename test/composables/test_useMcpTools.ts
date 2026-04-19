import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { computed } from "vue";
import { useMcpTools } from "../../src/composables/useMcpTools.js";
import type { Role } from "../../src/config/roles.js";

// Error-surfacing tests for issue #280 surface (A). The composable
// must expose `mcpToolsError` while keeping its "all tools visible"
// fallback (disabled set unchanged on failure).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalFetch: any = (globalThis as any).fetch;

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = originalFetch;
});

function stubFetch(
  impl: (input: unknown, init?: unknown) => Promise<Response>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = impl;
}

function mockJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const fakeRole = computed<Role>(() => ({
  id: "test",
  name: "Test",
  icon: "",
  prompt: "",
  availablePlugins: [],
}));

function makeComposable() {
  return useMcpTools({
    currentRole: fakeRole,
    getDefinition: () => null,
  });
}

describe("useMcpTools — error surfacing (#280)", () => {
  it("sets mcpToolsError on HTTP failure and keeps the fallback", async () => {
    const { mcpToolsError, disabledMcpTools, fetchMcpToolsStatus } =
      makeComposable();

    stubFetch(async () => mockJsonResponse(500, { error: "tool svc down" }));
    await fetchMcpToolsStatus();

    assert.ok(mcpToolsError.value, "error surfaced");
    assert.equal(
      disabledMcpTools.value.size,
      0,
      "fallback preserved — no tools marked disabled",
    );
  });

  it("sets a shape-error message on non-array payloads", async () => {
    const { mcpToolsError, fetchMcpToolsStatus } = makeComposable();

    stubFetch(async () => mockJsonResponse(200, { unexpected: true }));
    await fetchMcpToolsStatus();

    assert.ok(
      mcpToolsError.value &&
        /Unexpected response shape/.test(mcpToolsError.value),
      "shape-error populated",
    );
  });

  it("clears mcpToolsError on the next successful fetch", async () => {
    const { mcpToolsError, disabledMcpTools, fetchMcpToolsStatus } =
      makeComposable();

    stubFetch(async () => mockJsonResponse(500, { error: "bad" }));
    await fetchMcpToolsStatus();
    assert.ok(mcpToolsError.value);

    stubFetch(async () =>
      mockJsonResponse(200, [
        { name: "a", enabled: true },
        { name: "b", enabled: false },
      ]),
    );
    await fetchMcpToolsStatus();
    assert.equal(mcpToolsError.value, null);
    assert.equal(disabledMcpTools.value.has("b"), true);
    assert.equal(disabledMcpTools.value.has("a"), false);
  });
});
