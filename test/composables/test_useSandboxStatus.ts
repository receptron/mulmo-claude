import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useSandboxStatus } from "../../src/composables/useSandboxStatus.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalFetch: any = (globalThis as any).fetch;

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = originalFetch;
});

function stubFetch(impl: (input: unknown, init?: unknown) => Promise<Response>): void {
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

describe("useSandboxStatus", () => {
  it("status is null until ensureLoaded resolves", () => {
    const { status } = useSandboxStatus();
    assert.equal(status.value, null);
  });

  it("populates status from a successful /api/sandbox response", async () => {
    stubFetch(async () => mockJsonResponse(200, { sshAgent: true, mounts: ["gh", "gitconfig"] }));
    const { status, ensureLoaded } = useSandboxStatus();
    await ensureLoaded();
    assert.deepEqual(status.value, {
      sshAgent: true,
      mounts: ["gh", "gitconfig"],
    });
  });

  it("leaves status null when the server responds with `{}` (sandbox disabled)", async () => {
    // Shouldn't happen in practice — the popup only calls us when
    // sandboxEnabled is true — but the validator must still keep
    // status null rather than crashing on the empty-object shape.
    stubFetch(async () => mockJsonResponse(200, {}));
    const { status, ensureLoaded } = useSandboxStatus();
    await ensureLoaded();
    assert.equal(status.value, null);
  });

  it("caches successful loads — only calls the network once", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls++;
      return mockJsonResponse(200, { sshAgent: false, mounts: [] });
    });
    const { ensureLoaded } = useSandboxStatus();
    await ensureLoaded();
    await ensureLoaded();
    await ensureLoaded();
    assert.equal(calls, 1);
  });

  it("retries after a failed fetch (cache flip on error)", async () => {
    // First attempt fails → status stays null, `loaded` internal flag
    // is reset so the next ensureLoaded tries again. This matters
    // because the popup reopens on every click and the user expects
    // a flaky network to recover without a page reload.
    let attempts = 0;
    stubFetch(async () => {
      attempts++;
      if (attempts === 1) return mockJsonResponse(500, { error: "boom" });
      return mockJsonResponse(200, { sshAgent: true, mounts: [] });
    });
    const { status, ensureLoaded } = useSandboxStatus();
    await ensureLoaded();
    assert.equal(status.value, null);
    await ensureLoaded();
    assert.deepEqual(status.value, { sshAgent: true, mounts: [] });
    assert.equal(attempts, 2);
  });

  it("rejects malformed payloads (missing fields, wrong types)", async () => {
    stubFetch(async () => mockJsonResponse(200, { sshAgent: "yes", mounts: [1, 2, 3] }));
    const { status, ensureLoaded } = useSandboxStatus();
    await ensureLoaded();
    // Validator should drop the payload rather than letting bad types
    // leak into the UI render.
    assert.equal(status.value, null);
  });
});
