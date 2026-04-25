import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { pushToMacosReminderWithDeps, type Spawner } from "../../server/system/macosNotify.js";

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

// Build a minimal ChildProcess stub: an EventEmitter with a `stderr`
// emitter (needed by the production code's listener) and a small
// helper to fire `close` after the test arranges it.
function makeStubChild(): { child: ChildProcess; finish: (code: number, stderrChunk?: string) => void; error: (err: Error) => void } {
  const emitter = new EventEmitter() as unknown as ChildProcess;
  const stderrEmitter = new EventEmitter();
  Object.defineProperty(emitter, "stderr", { value: stderrEmitter });
  return {
    child: emitter,
    finish: (code, stderrChunk) => {
      if (stderrChunk) stderrEmitter.emit("data", stderrChunk);
      (emitter as unknown as EventEmitter).emit("close", code);
    },
    error: (err) => (emitter as unknown as EventEmitter).emit("error", err),
  };
}

function makeSpawner(): { spawner: Spawner; calls: SpawnCall[]; respond: (code: number, stderrChunk?: string) => void; throwError: (err: Error) => void } {
  const calls: SpawnCall[] = [];
  let pending: ReturnType<typeof makeStubChild> | null = null;
  const spawner: Spawner = (command, args, options) => {
    calls.push({ command, args, options });
    pending = makeStubChild();
    return pending.child;
  };
  return {
    spawner,
    calls,
    respond: (code, stderrChunk) => pending?.finish(code, stderrChunk),
    throwError: (err) => pending?.error(err),
  };
}

describe("pushToMacosReminderWithDeps — gating", () => {
  it("fires by default on darwin (opt-out semantics)", async () => {
    const { spawner, calls, respond } = makeSpawner();
    const promise = pushToMacosReminderWithDeps({ spawner, platform: "darwin", disabled: false }, "Hello");
    respond(0);
    await promise;
    assert.equal(calls.length, 1);
  });

  it("no-ops when DISABLE_MACOS_REMINDER_NOTIFICATIONS is set", async () => {
    const { spawner, calls } = makeSpawner();
    await pushToMacosReminderWithDeps({ spawner, platform: "darwin", disabled: true }, "Hello");
    assert.equal(calls.length, 0);
  });

  it("no-ops silently on non-darwin platforms regardless of disabled flag", async () => {
    const { spawner, calls } = makeSpawner();
    await pushToMacosReminderWithDeps({ spawner, platform: "linux", disabled: false }, "first");
    await pushToMacosReminderWithDeps({ spawner, platform: "linux", disabled: true }, "second");
    assert.equal(calls.length, 0);
  });
});

describe("pushToMacosReminderWithDeps — spawn arguments", () => {
  it("invokes osascript with the AppleScript on -e", async () => {
    const { spawner, calls, respond } = makeSpawner();
    const promise = pushToMacosReminderWithDeps({ spawner, platform: "darwin", disabled: false }, "Hello");
    respond(0);
    await promise;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "osascript");
    assert.equal(calls[0].args[0], "-e");
    assert.match(calls[0].args[1] as string, /on run argv/);
    assert.match(calls[0].args[1] as string, /tell application "Reminders"/);
  });

  it("forwards title and body as argv (Unicode-safe path)", async () => {
    const { spawner, calls, respond } = makeSpawner();
    const promise = pushToMacosReminderWithDeps(
      { spawner, platform: "darwin", disabled: false },
      'Title with "quotes" and \\backslash and 日本語',
      "Body line 1\nBody line 2 — 文字化け確認",
    );
    respond(0);
    await promise;
    // argv layout: [-e, SCRIPT, --, title, body]
    assert.equal(calls[0].args[2], "--");
    assert.equal(calls[0].args[3], 'Title with "quotes" and \\backslash and 日本語');
    assert.equal(calls[0].args[4], "Body line 1\nBody line 2 — 文字化け確認");
  });

  it("sends an empty-string body when none is supplied", async () => {
    const { spawner, calls, respond } = makeSpawner();
    const promise = pushToMacosReminderWithDeps({ spawner, platform: "darwin", disabled: false }, "Title only");
    respond(0);
    await promise;
    assert.equal(calls[0].args[4], "");
  });
});

describe("pushToMacosReminderWithDeps — failure handling", () => {
  it("resolves silently when the subprocess emits an error", async () => {
    const { spawner, throwError } = makeSpawner();
    const promise = pushToMacosReminderWithDeps({ spawner, platform: "darwin", disabled: false }, "Hello");
    throwError(new Error("ENOENT"));
    await promise; // does not reject
  });

  it("resolves silently on non-zero exit", async () => {
    const { spawner, respond } = makeSpawner();
    const promise = pushToMacosReminderWithDeps({ spawner, platform: "darwin", disabled: false }, "Hello");
    respond(1, "Reminders.app is not authorised");
    await promise; // does not reject
  });

  it("resolves silently when spawn itself throws synchronously", async () => {
    const throwingSpawner: Spawner = () => {
      throw new Error("synchronous spawn failure");
    };
    await pushToMacosReminderWithDeps({ spawner: throwingSpawner, platform: "darwin", disabled: false }, "Hello");
    // Reaching this line means no rejection — that's the assertion.
    assert.ok(true);
  });
});
