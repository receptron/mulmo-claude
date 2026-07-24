// The per-platform argv for opening and revealing a file, plus the spawn
// handling around it — WITHOUT launching anything. Running the real command in
// a test opens Finder on macOS and Explorer on Windows, which is how the CI
// runner ends up spawning file-manager windows. The argv choice is pure, and
// the spawn wrapper takes an injectable spawner, so both are checked directly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { openArgv, revealArgv, openInHostOs, revealInHostOs, type Spawner } from "../../server/api/routes/files.ts";

const ABS = "/work/artifacts/report.html";

describe("openArgv", () => {
  it("uses `open` on macOS", () => {
    assert.deepEqual(openArgv(ABS, "darwin"), { command: "open", args: [ABS] });
  });

  it("uses `explorer.exe` on Windows", () => {
    assert.deepEqual(openArgv(ABS, "win32"), { command: "explorer.exe", args: [ABS] });
  });

  it("uses `xdg-open` on Linux and other platforms", () => {
    assert.deepEqual(openArgv(ABS, "linux"), { command: "xdg-open", args: [ABS] });
    assert.deepEqual(openArgv(ABS, "freebsd"), { command: "xdg-open", args: [ABS] });
  });

  // The whole point of an argv array over a shell string: a metacharacter in
  // the path is one argument, never command syntax.
  it("passes a metacharacter-bearing path as a single argument", () => {
    const nasty = "/work/a; rm -rf ~/b.html";
    assert.deepEqual(openArgv(nasty, "darwin").args, [nasty]);
  });
});

describe("revealArgv", () => {
  // macOS and Windows select the file inside its folder; the `-R` / `/select,`
  // is the difference from a plain open.
  it("selects the file on macOS with -R", () => {
    assert.deepEqual(revealArgv(ABS, "darwin"), { command: "open", args: ["-R", ABS] });
  });

  it("selects the file on Windows with /select,", () => {
    assert.deepEqual(revealArgv(ABS, "win32"), { command: "explorer.exe", args: [`/select,${ABS}`] });
  });

  // Linux has no portable "select this item", so it opens the CONTAINING
  // folder — the argument is the dirname, not the file.
  it("opens the containing folder on Linux", () => {
    assert.deepEqual(revealArgv(ABS, "linux"), { command: "xdg-open", args: ["/work/artifacts"] });
  });
});

/** A spawner that records its call and lets the test drive the child's events,
 *  so nothing is actually launched. */
function fakeSpawner() {
  const calls: { command: string; args: readonly string[] }[] = [];
  let child: EventEmitter & { unref?: () => void };
  const spawner = ((command: string, args: readonly string[]) => {
    calls.push({ command, args });
    child = Object.assign(new EventEmitter(), { unref: () => {} });
    return child as unknown as ChildProcess;
  }) as unknown as Spawner;
  return { spawner, calls, emitSpawn: () => child.emit("spawn"), emitError: (err: Error) => child.emit("error", err) };
}

describe("openInHostOs / revealInHostOs — spawn handling", () => {
  it("spawns the open argv for the current platform and resolves true on spawn", async () => {
    const fake = fakeSpawner();
    const done = openInHostOs(ABS, fake.spawner);
    fake.emitSpawn();
    assert.equal(await done, true);
    assert.deepEqual(fake.calls, [openArgv(ABS, process.platform)]);
  });

  it("spawns the reveal argv for the current platform", async () => {
    const fake = fakeSpawner();
    const done = revealInHostOs(ABS, fake.spawner);
    fake.emitSpawn();
    assert.equal(await done, true);
    assert.deepEqual(fake.calls, [revealArgv(ABS, process.platform)]);
  });

  // A missing file manager (no `xdg-open` on a minimal Linux runner) fires an
  // error event; the caller must see false, not a rejected promise.
  it("resolves false when the spawn errors", async () => {
    const fake = fakeSpawner();
    const done = openInHostOs(ABS, fake.spawner);
    fake.emitError(new Error("ENOENT"));
    assert.equal(await done, false);
  });

  // Whichever event fires first wins; a later one must not flip the result.
  it("ignores an error that arrives after a successful spawn", async () => {
    const fake = fakeSpawner();
    const done = openInHostOs(ABS, fake.spawner);
    fake.emitSpawn();
    fake.emitError(new Error("late"));
    assert.equal(await done, true);
  });
});
