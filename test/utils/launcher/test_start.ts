// Tests for the decisions in `server/utils/launcher/start.mjs` that can
// be checked without actually launching anything.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";

import { launcherLogPath, serverSpawnPlan } from "../../../server/utils/launcher/start.mjs";

describe("serverSpawnPlan", () => {
  it("asks npx for the latest release on the chosen port, without opening a browser", () => {
    const { command, args } = serverSpawnPlan({ port: 3005 });
    assert.equal(command, "npx");
    assert.deepEqual(args, ["mulmoclaude@latest", "--port", "3005", "--no-open"]);
  });

  it("passes --no-open — the progress page does the navigating, so the CLI must not open a second tab", () => {
    assert.ok(serverSpawnPlan({ port: 3001 }).args.includes("--no-open"));
  });

  it("runs from home, never the `/` a GUI launch inherits", () => {
    // The CLI reads `<cwd>/.env`. With the inherited cwd that is `/.env`,
    // which the user cannot write — the documented way to supply
    // GEMINI_API_KEY would quietly do nothing from the icon.
    assert.equal(serverSpawnPlan({ port: 3001, home: "/Users/example" }).cwd, "/Users/example");
    assert.equal(serverSpawnPlan({ port: 3001 }).cwd, homedir());
    assert.notEqual(serverSpawnPlan({ port: 3001 }).cwd, "/");
  });
});

describe("launcherLogPath", () => {
  it("uses the per-app location Console.app also looks at", () => {
    assert.equal(launcherLogPath("/Users/example"), join("/Users/example", "Library", "Logs", "MulmoClaude", "launcher.log"));
  });
});
