import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildSandboxStatus } from "../../server/api/sandboxStatus.js";

// Isolated fixture home so the tests don't depend on the developer
// actually having ~/.config/gh or a ~/.gitconfig locally. Shares the
// same pattern as test_sandboxMounts.ts.
function makeFixtureHome(opts: { gh?: boolean; gitconfig?: boolean }): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sandbox-status-"));
  if (opts.gh) {
    const ghDir = path.join(dir, ".config", "gh");
    mkdirSync(ghDir, { recursive: true });
    writeFileSync(path.join(ghDir, "hosts.yml"), "github.com:\n");
  }
  if (opts.gitconfig) {
    writeFileSync(path.join(dir, ".gitconfig"), "[user]\n  name = t\n");
  }
  return dir;
}

// Real socket is awkward to stand up in tests; a regular file is
// enough since sshAgentForwardArgs only needs `existsSync` to pass.
function makeFakeSocket(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sandbox-status-sock-"));
  const sock = path.join(dir, "agent.sock");
  writeFileSync(sock, "");
  return sock;
}

describe("buildSandboxStatus", () => {
  it("returns null when the sandbox is disabled", () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const status = buildSandboxStatus({
      sandboxEnabled: false,
      sshAgentForward: true,
      configMountNames: ["gh", "gitconfig"],
      sshAuthSock: makeFakeSocket(),
      home,
    });
    // null → handler serializes `{}`. Contract is NOT a stub object
    // with false/empty fields — the UI already has a distinct
    // "no sandbox" branch and extra fields would be dead pixels.
    assert.equal(status, null);
  });

  it("returns sshAgent=false and empty mounts when nothing is opted in", () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: false,
      configMountNames: [],
      home,
    });
    assert.deepEqual(status, { sshAgent: false, mounts: [] });
  });

  it("reports a config mount whose host path exists", () => {
    const home = makeFixtureHome({ gh: true });
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: false,
      configMountNames: ["gh"],
      home,
    });
    assert.deepEqual(status, { sshAgent: false, mounts: ["gh"] });
  });

  it("silently drops a config mount whose host path is missing", () => {
    // No gh/gitconfig in the fixture home, but the user requested
    // `gh`. Must not surface it as mounted — mirrors the log-level
    // "config mount skipped" behaviour.
    const home = makeFixtureHome({});
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: false,
      configMountNames: ["gh"],
      home,
    });
    assert.deepEqual(status, { sshAgent: false, mounts: [] });
  });

  it("drops unknown config names silently (log handles the warning)", () => {
    // Unknown names are logged by `resolveSandboxAuth` in the agent
    // spawner; the API status snapshot should not leak that noise.
    const home = makeFixtureHome({ gh: true });
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: false,
      configMountNames: ["gh", "does-not-exist"],
      home,
    });
    assert.deepEqual(status, { sshAgent: false, mounts: ["gh"] });
  });

  it("reports sshAgent=true when the flag is on AND the socket exists", () => {
    const home = makeFixtureHome({});
    const sshAuthSock = makeFakeSocket();
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: true,
      configMountNames: [],
      sshAuthSock,
      home,
    });
    assert.deepEqual(status, { sshAgent: true, mounts: [] });
  });

  it("reports sshAgent=false when the flag is on but SSH_AUTH_SOCK is unset (Linux)", () => {
    const home = makeFixtureHome({});
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: true,
      configMountNames: [],
      sshAuthSock: undefined,
      home,
      platform: "linux",
    });
    assert.deepEqual(status, { sshAgent: false, mounts: [] });
  });

  it("reports sshAgent=true on macOS even without SSH_AUTH_SOCK (Docker Desktop magic socket)", () => {
    const home = makeFixtureHome({});
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: true,
      configMountNames: [],
      sshAuthSock: undefined,
      home,
      platform: "darwin",
    });
    assert.deepEqual(status, { sshAgent: true, mounts: [] });
  });

  it("reports sshAgent=false when the socket path does not exist on the host (Linux)", () => {
    const home = makeFixtureHome({});
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: true,
      configMountNames: [],
      sshAuthSock: path.join(home, "missing-socket"),
      home,
      platform: "linux",
    });
    assert.deepEqual(status, { sshAgent: false, mounts: [] });
  });

  it("preserves config-mount order from the CSV", () => {
    // Users type `SANDBOX_MOUNT_CONFIGS=gitconfig,gh` and expect the
    // popup to render them in that order.
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: false,
      configMountNames: ["gitconfig", "gh"],
      home,
    });
    assert.deepEqual(status, {
      sshAgent: false,
      mounts: ["gitconfig", "gh"],
    });
  });

  it("combines ssh agent + config mounts when both are opted in", () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const status = buildSandboxStatus({
      sandboxEnabled: true,
      sshAgentForward: true,
      configMountNames: ["gh", "gitconfig"],
      sshAuthSock: makeFakeSocket(),
      home,
    });
    assert.deepEqual(status, {
      sshAgent: true,
      mounts: ["gh", "gitconfig"],
    });
  });
});
