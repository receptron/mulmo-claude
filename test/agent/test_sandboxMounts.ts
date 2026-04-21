import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  buildAllowedConfigMounts,
  resolveMountNames,
  configMountArgs,
  sshAgentForwardArgs,
  SSH_AGENT_CONTAINER_SOCK,
} from "../../server/agent/sandboxMounts.js";

// Use an isolated temp HOME so these tests don't depend on whether
// the developer running CI actually has ~/.config/gh or a ~/.gitconfig.

function makeFixtureHome(opts: { gh?: boolean; gitconfig?: boolean }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-mounts-"));
  if (opts.gh) {
    const ghDir = path.join(dir, ".config", "gh");
    fs.mkdirSync(ghDir, { recursive: true });
    fs.writeFileSync(path.join(ghDir, "hosts.yml"), "github.com:\n");
  }
  if (opts.gitconfig) {
    fs.writeFileSync(path.join(dir, ".gitconfig"), "[user]\n  name = t\n");
  }
  return dir;
}

describe("buildAllowedConfigMounts", () => {
  it("exposes every expected name", () => {
    const allowed = buildAllowedConfigMounts("/fake/home");
    assert.deepEqual(Object.keys(allowed).sort(), ["gh", "gitconfig"]);
  });

  it("maps names to stable host paths under the given home", () => {
    const allowed = buildAllowedConfigMounts("/fake/home");
    assert.equal(allowed.gh.hostPath, path.join("/fake/home", ".config", "gh"));
    assert.equal(allowed.gh.containerPath, "/home/node/.config/gh");
    assert.equal(allowed.gh.kind, "dir");
    assert.equal(allowed.gitconfig.hostPath, path.join("/fake/home", ".gitconfig"));
    assert.equal(allowed.gitconfig.kind, "file");
  });
});

describe("resolveMountNames", () => {
  it("empty input → empty output", () => {
    const out = resolveMountNames([], buildAllowedConfigMounts("/fake/home"));
    assert.deepEqual(out, { resolved: [], unknown: [], missing: [] });
  });

  it("flags unknown names without crashing", () => {
    const out = resolveMountNames(["nope", "also-nope"], buildAllowedConfigMounts("/fake/home"));
    assert.deepEqual(out.unknown, ["nope", "also-nope"]);
    assert.equal(out.resolved.length, 0);
  });

  it("reports missing host paths separately from unknown", () => {
    const home = makeFixtureHome({}); // nothing on disk
    const out = resolveMountNames(["gh"], buildAllowedConfigMounts(home));
    assert.equal(out.unknown.length, 0);
    assert.equal(out.resolved.length, 0);
    assert.equal(out.missing.length, 1);
    assert.equal(out.missing[0].name, "gh");
  });

  it("resolves a present dir", () => {
    const home = makeFixtureHome({ gh: true });
    const out = resolveMountNames(["gh"], buildAllowedConfigMounts(home));
    assert.equal(out.resolved.length, 1);
    assert.equal(out.resolved[0].name, "gh");
  });

  it("resolves a present file", () => {
    const home = makeFixtureHome({ gitconfig: true });
    const out = resolveMountNames(["gitconfig"], buildAllowedConfigMounts(home));
    assert.equal(out.resolved.length, 1);
    assert.equal(out.resolved[0].name, "gitconfig");
  });

  it("rejects dir when host path is a file and vice versa", () => {
    const home = makeFixtureHome({ gh: false, gitconfig: false });
    // Place a FILE where gh expects a DIR.
    fs.mkdirSync(path.join(home, ".config"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "gh"), "oops");
    const out = resolveMountNames(["gh"], buildAllowedConfigMounts(home));
    assert.equal(out.resolved.length, 0);
    assert.equal(out.missing.length, 1);
  });

  it("preserves CSV order, skips blanks", () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const out = resolveMountNames(["gitconfig", "", "gh"], buildAllowedConfigMounts(home));
    assert.deepEqual(
      out.resolved.map((mount) => mount.name),
      ["gitconfig", "gh"],
    );
  });
});

describe("configMountArgs", () => {
  it("emits read-only -v pairs for each spec", () => {
    const home = makeFixtureHome({ gh: true, gitconfig: true });
    const { resolved } = resolveMountNames(["gh", "gitconfig"], buildAllowedConfigMounts(home));
    const args = configMountArgs(resolved);
    assert.equal(args[0], "-v");
    assert.match(args[1], /:\/home\/node\/\.config\/gh:ro$/);
    assert.equal(args[2], "-v");
    assert.match(args[3], /:\/home\/node\/\.gitconfig:ro$/);
    assert.equal(args.length, 4);
  });

  it("empty input → empty args", () => {
    assert.deepEqual(configMountArgs([]), []);
  });
});

describe("sshAgentForwardArgs", () => {
  it("no-op when disabled", () => {
    const result = sshAgentForwardArgs(false, "/tmp/anything");
    assert.deepEqual(result, { args: [], skippedReason: null });
  });

  it("uses Docker Desktop magic socket on macOS", () => {
    const result = sshAgentForwardArgs(true, "/tmp/irrelevant", "darwin");
    assert.equal(result.skippedReason, null);
    assert.deepEqual(result.args, ["-v", `/run/host-services/ssh-auth.sock:${SSH_AGENT_CONTAINER_SOCK}`, "-e", `SSH_AUTH_SOCK=${SSH_AGENT_CONTAINER_SOCK}`]);
  });

  it("macOS path ignores SSH_AUTH_SOCK value entirely", () => {
    const result = sshAgentForwardArgs(true, undefined, "darwin");
    assert.equal(result.skippedReason, null);
    assert.equal(result.args.length, 4);
  });

  it("reports SSH_AUTH_SOCK missing on Linux", () => {
    const result = sshAgentForwardArgs(true, undefined, "linux");
    assert.deepEqual(result.args, []);
    assert.match(result.skippedReason ?? "", /not set/);
  });

  it("reports socket path missing on disk (Linux)", () => {
    const result = sshAgentForwardArgs(true, "/tmp/definitely-not-a-real-sock", "linux");
    assert.deepEqual(result.args, []);
    assert.match(result.skippedReason ?? "", /not found/);
  });

  it("binds socket and sets SSH_AUTH_SOCK when sock exists (Linux)", () => {
    const fake = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sock-")), "agent.sock");
    fs.writeFileSync(fake, "");
    const result = sshAgentForwardArgs(true, fake, "linux");
    assert.equal(result.skippedReason, null);
    const expectedHostPath = fake.replace(/\\/g, "/");
    assert.deepEqual(result.args, ["-v", `${expectedHostPath}:${SSH_AGENT_CONTAINER_SOCK}`, "-e", `SSH_AUTH_SOCK=${SSH_AGENT_CONTAINER_SOCK}`]);
  });
});
