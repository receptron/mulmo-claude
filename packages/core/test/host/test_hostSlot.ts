import assert from "node:assert/strict";
import { test } from "node:test";

import { createForwardingLogger, createHostSlot, type StructuredLogger } from "../../src/host/hostSlot.ts";
import { configureCollectionHost, getWorkspaceRoot, log as collectionLog, type CollectionHost } from "../../src/collection/server/host.ts";
import { configureFeedsHost, log as feedsLog, requireFeedsHost, resetFeedsHostForTesting, type FeedsHost } from "../../src/feeds/server/host.ts";
import { configureGoogleHost, log as googleLog } from "../../src/google/host.ts";

interface LogCall {
  level: string;
  prefix: string;
  message: string;
  data?: Record<string, unknown>;
}

function recordingLogger(): { logger: StructuredLogger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const record = (level: string) => (prefix: string, message: string, data?: Record<string, unknown>) => {
    calls.push({ level, prefix, message, data });
  };
  return { logger: { error: record("error"), warn: record("warn"), info: record("info"), debug: record("debug") }, calls };
}

function assertThrowsWith(action: () => unknown, ...needles: string[]): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, "expected a thrown Error");
  for (const needle of needles) {
    assert.ok(thrown.message.includes(needle), `expected "${needle}" in "${thrown.message}"`);
  }
}

const SLOT_NAME = "@mulmoclaude/core/example: configureExampleHost()";

test("createHostSlot: get before set throws with the slot name", () => {
  const slot = createHostSlot<{ v: number }>(SLOT_NAME);
  assertThrowsWith(() => slot.get(), SLOT_NAME, "was not called by the host");
});

test("createHostSlot: peek is null before set", () => {
  const slot = createHostSlot<{ v: number }>(SLOT_NAME);
  assert.equal(slot.peek(), null);
});

test("createHostSlot: set then get/peek resolves the value", () => {
  const slot = createHostSlot<{ v: number }>(SLOT_NAME);
  const value = { v: 1 };
  slot.set(value);
  assert.equal(slot.get(), value);
  assert.equal(slot.peek(), value);
});

test("createHostSlot: re-setting the same value is a no-op", () => {
  const slot = createHostSlot<{ v: number }>(SLOT_NAME);
  const value = { v: 1 };
  slot.set(value);
  assert.doesNotThrow(() => slot.set(value));
  assert.equal(slot.get(), value);
});

test("createHostSlot: re-setting a different value throws with the slot name", () => {
  const slot = createHostSlot<{ v: number }>(SLOT_NAME);
  slot.set({ v: 1 });
  assertThrowsWith(() => slot.set({ v: 2 }), SLOT_NAME, "was already called with a different host");
});

test("createHostSlot: reset clears the value", () => {
  const slot = createHostSlot<{ v: number }>(SLOT_NAME);
  slot.set({ v: 1 });
  slot.reset();
  assert.equal(slot.peek(), null);
  assertThrowsWith(() => slot.get(), "was not called by the host");
});

test("createForwardingLogger: drops calls before a logger is available", () => {
  const backing: StructuredLogger | null = null;
  const forwarding = createForwardingLogger(() => backing);
  assert.doesNotThrow(() => forwarding.info("prefix", "message"));
});

test("createForwardingLogger: forwards to the backing logger once available", () => {
  const { logger, calls } = recordingLogger();
  let backing: StructuredLogger | null = null;
  const forwarding = createForwardingLogger(() => backing);
  forwarding.error("dropped", "before");
  backing = logger;
  forwarding.error("p1", "boom", { code: 1 });
  forwarding.debug("p2", "trace");
  assert.deepEqual(calls, [
    { level: "error", prefix: "p1", message: "boom", data: { code: 1 } },
    { level: "debug", prefix: "p2", message: "trace", data: undefined },
  ]);
});

test("collection host slot: getWorkspaceRoot throws unset, log no-ops unset, both resolve once configured", () => {
  assertThrowsWith(() => getWorkspaceRoot(), "@mulmoclaude/core/collection/server", "was not called by the host");
  assert.doesNotThrow(() => collectionLog.info("collections", "pre-config drop"));

  const { logger, calls } = recordingLogger();
  const host: CollectionHost = {
    workspaceRoot: "/ws",
    log: logger,
    paths: {
      userSkillsDir: "/ws/.user-skills",
      projectSkillsDir: (root) => `${root}/.claude/skills`,
      feedsRoot: (root) => `${root}/data/feeds`,
      skillsStagingDir: (root) => `${root}/data/skills`,
      archiveDir: "data/archive",
      collectionsRegistriesConfig: (root) => `${root}/config/collections-registries.json`,
    },
    isPresetSlug: () => false,
  };
  configureCollectionHost(host);

  assert.equal(getWorkspaceRoot(), "/ws");
  collectionLog.warn("collections", "post-config");
  assert.deepEqual(calls, [{ level: "warn", prefix: "collections", message: "post-config", data: undefined }]);
});

test("feeds host slot: requireFeedsHost throws unset, log no-ops unset (fixed), reset clears", () => {
  assertThrowsWith(() => requireFeedsHost(), "@mulmoclaude/core/feeds", "was not called by the host");
  // Behaviour change under this refactor: feeds' log used to THROW when unset
  // (it forwarded through requireFeedsHost().log); it now drops silently, in
  // line with the collection/google seams.
  assert.doesNotThrow(() => feedsLog.error("feeds", "pre-config drop"));

  const { logger, calls } = recordingLogger();
  const host: FeedsHost = {
    workspaceRoot: "/ws",
    log: logger,
    writeFileAtomic: async () => {},
    spawnWorker: async () => ({ ok: false, error: "noop" }),
  };
  configureFeedsHost(host);

  assert.equal(requireFeedsHost().workspaceRoot, "/ws");
  feedsLog.info("feeds", "post-config");
  assert.deepEqual(calls, [{ level: "info", prefix: "feeds", message: "post-config", data: undefined }]);

  resetFeedsHostForTesting();
  assertThrowsWith(() => requireFeedsHost(), "was not called by the host");
  assert.doesNotThrow(() => feedsLog.info("feeds", "post-reset drop"));
});

test("google host slot: log no-ops unset then forwards, re-binding a different logger throws", () => {
  assert.doesNotThrow(() => googleLog.warn("google", "pre-config drop"));

  const { logger, calls } = recordingLogger();
  configureGoogleHost({ log: logger });
  googleLog.error("google", "post-config", { status: 500 });
  assert.deepEqual(calls, [{ level: "error", prefix: "google", message: "post-config", data: { status: 500 } }]);

  // Behaviour change under this refactor: google used to silently overwrite;
  // re-binding a *different* logger now throws (defensive — the app configures
  // exactly once). Re-binding the same logger stays a no-op.
  const other = recordingLogger();
  assertThrowsWith(() => configureGoogleHost({ log: other.logger }), "@mulmoclaude/core/google", "was already called with a different host");
  assert.doesNotThrow(() => configureGoogleHost({ log: logger }));
});
