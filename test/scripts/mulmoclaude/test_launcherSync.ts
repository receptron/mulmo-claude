// Unit tests for scripts/mulmoclaude/launcherSync.mjs.
//
// Each case builds a self-contained fake workspace layout under
// t.diagnostic and drives the auditor against it. No network, no
// snapshot files — the invariant text is asserted inline.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodeOs from "node:os";
import * as sync from "../../../scripts/mulmoclaude/launcherSync.mjs";

interface FakePackage {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface Fixture {
  root: Record<string, unknown>;
  launcher: Record<string, unknown>;
  workspaces?: { dir: string; pkg: FakePackage }[];
}

function makeFakeRepo(fixture: Fixture): string {
  const root = mkdtempSync(path.join(nodeOs.tmpdir(), "launcher-sync-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify(fixture.root, null, 2));
  mkdirSync(path.join(root, "packages", "mulmoclaude"), { recursive: true });
  writeFileSync(path.join(root, "packages", "mulmoclaude", "package.json"), JSON.stringify(fixture.launcher, null, 2));
  for (const entry of fixture.workspaces ?? []) {
    const dir = path.join(root, entry.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(entry.pkg, null, 2));
  }
  return root;
}

describe("satisfies", () => {
  it("caret range on 0.y.z lets patches float within the same minor", () => {
    assert.equal(sync.satisfies("0.4.1", "^0.4.0"), true);
    assert.equal(sync.satisfies("0.4.0", "^0.4.0"), true);
    assert.equal(sync.satisfies("0.3.9", "^0.4.0"), false);
    assert.equal(sync.satisfies("0.5.0", "^0.4.0"), false);
  });

  it("caret range on 1.y.z lets minor+patch float within the same major", () => {
    assert.equal(sync.satisfies("1.4.9", "^1.2.0"), true);
    assert.equal(sync.satisfies("2.0.0", "^1.2.0"), false);
  });

  it("exact range requires exact match", () => {
    assert.equal(sync.satisfies("0.4.0", "0.4.0"), true);
    assert.equal(sync.satisfies("0.4.1", "0.4.0"), false);
  });

  it("returns null for URL / workspace / wildcard ranges", () => {
    assert.equal(sync.satisfies("1.2.3", "https://example.com/foo.tgz"), null);
    assert.equal(sync.satisfies("1.2.3", "workspace:*"), null);
    assert.equal(sync.satisfies("1.2.3", "*"), null);
  });
});

describe("auditLauncherSync — invariant 1: root ↔ launcher common dep", () => {
  it("passes when the common dep ranges match", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: { "gui-chat-protocol": "0.4.0" } },
      launcher: { name: "mulmoclaude", dependencies: { "gui-chat-protocol": "0.4.0" } },
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.deepEqual(findings, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags when root and launcher diverge on the same dep", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: { "gui-chat-protocol": "0.4.0" } },
      launcher: { name: "mulmoclaude", dependencies: { "gui-chat-protocol": "^0.3.0" } },
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const mismatches = findings.filter((finding) => finding.kind === "root-launcher-mismatch");
      assert.equal(mismatches.length, 1);
      const [mismatch] = mismatches;
      assert.ok(mismatch);
      assert.match(mismatch.message, /gui-chat-protocol.*root=0\.4\.0.*launcher=\^0\.3\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditLauncherSync — invariant 2: workspace source vs launcher range", () => {
  it("passes when the workspace source satisfies the launcher range", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: { "@mulmoclaude/form-plugin": "^0.1.4" } },
      workspaces: [{ dir: "packages/plugins/form-plugin", pkg: { name: "@mulmoclaude/form-plugin", version: "0.1.4" } }],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.deepEqual(findings, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags when the workspace source is behind the launcher range's lower bound", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: { "@mulmoclaude/form-plugin": "^0.2.0" } },
      workspaces: [{ dir: "packages/plugins/form-plugin", pkg: { name: "@mulmoclaude/form-plugin", version: "0.1.4" } }],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const drifts = findings.filter((finding) => finding.kind === "workspace-source-drift");
      assert.equal(drifts.length, 1);
      const [drift] = drifts;
      assert.ok(drift);
      assert.match(drift.message, /form-plugin.*0\.1\.4.*\^0\.2\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditLauncherSync — invariant 3: plugin peer dep vs launcher pin (#1920 anti-regression)", () => {
  it("flags a bundled plugin whose peer dep does NOT satisfy the launcher pin", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: {
          "@mulmoclaude/form-plugin": "^0.1.3",
          "gui-chat-protocol": "0.4.0",
        },
      },
      workspaces: [
        {
          dir: "packages/plugins/form-plugin",
          pkg: { name: "@mulmoclaude/form-plugin", version: "0.1.3", peerDependencies: { "gui-chat-protocol": "^0.3.0" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const violations = findings.filter((finding) => finding.kind === "peer-dep-violation");
      assert.equal(violations.length, 1);
      const [violation] = violations;
      assert.ok(violation);
      assert.match(violation.message, /form-plugin.*gui-chat-protocol.*\^0\.3\.0.*0\.4\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when the plugin peer dep is compatible with the launcher pin", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: {
          "@mulmoclaude/form-plugin": "^0.1.4",
          "gui-chat-protocol": "0.4.0",
        },
      },
      workspaces: [
        {
          dir: "packages/plugins/form-plugin",
          pkg: { name: "@mulmoclaude/form-plugin", version: "0.1.4", peerDependencies: { "gui-chat-protocol": "^0.4.0" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.deepEqual(findings, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not check peer deps for non-plugin workspace deps", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: { "@mulmoclaude/core": "^0.5.1", "gui-chat-protocol": "0.4.0" },
      },
      workspaces: [
        {
          dir: "packages/core",
          pkg: { name: "@mulmoclaude/core", version: "0.5.1", peerDependencies: { "gui-chat-protocol": "^0.3.0" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const violations = findings.filter((finding) => finding.kind === "peer-dep-violation");
      assert.equal(violations.length, 0, "core is not a bundled plugin; its peer dep should not fail the gate");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditLauncherSync — invariant 4: workspace-source strict lockstep", () => {
  it("flags when workspace source is AHEAD of launcher range lower bound", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: { "@mulmoclaude/foo-plugin": "^0.1.4" } },
      workspaces: [{ dir: "packages/plugins/foo-plugin", pkg: { name: "@mulmoclaude/foo-plugin", version: "0.1.5" } }],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const lockstep = findings.filter((finding) => finding.kind === "workspace-lockstep");
      assert.equal(lockstep.length, 1);
      const [lockstepFinding] = lockstep;
      assert.ok(lockstepFinding);
      assert.match(lockstepFinding.message, /foo-plugin.*0\.1\.5.*\^0\.1\.4/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when workspace source equals launcher range lower bound", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: { "@mulmoclaude/foo-plugin": "^0.1.5" } },
      workspaces: [{ dir: "packages/plugins/foo-plugin", pkg: { name: "@mulmoclaude/foo-plugin", version: "0.1.5" } }],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.deepEqual(findings, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditLauncherSync — invariant 5: gui-chat-protocol peer dep lockstep", () => {
  it("flags a bundled plugin whose gui-chat-protocol peer lags a minor behind launcher (>=1.x)", async () => {
    // For 0.y.z, invariant 3 (peer-dep-violation) already catches minor drift
    // because caret ranges are strict on minor when major=0. Invariant 5 only
    // adds independent value once the protocol reaches 1.0+, where the caret
    // range widens to full-minor. This test uses 1.x.x to exercise invariant 5
    // alone.
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: {
          "@mulmoclaude/foo-plugin": "^0.1.5",
          "gui-chat-protocol": "1.5.0",
        },
      },
      workspaces: [
        {
          dir: "packages/plugins/foo-plugin",
          pkg: { name: "@mulmoclaude/foo-plugin", version: "0.1.5", peerDependencies: { "gui-chat-protocol": "^1.4.0" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const lockstep = findings.filter((finding) => finding.kind === "peer-dep-lockstep");
      assert.equal(lockstep.length, 1);
      const [lockstepFinding] = lockstep;
      assert.ok(lockstepFinding);
      assert.match(lockstepFinding.message, /foo-plugin.*gui-chat-protocol.*\^1\.4\.0.*1\.5\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does NOT enforce lockstep for non-protocol peers (zod / vue / express)", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: {
          "@mulmoclaude/foo-plugin": "^0.1.5",
          zod: "^4.4.3",
        },
      },
      workspaces: [
        {
          dir: "packages/plugins/foo-plugin",
          pkg: { name: "@mulmoclaude/foo-plugin", version: "0.1.5", peerDependencies: { zod: "^4.3.6" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const lockstep = findings.filter((finding) => finding.kind === "peer-dep-lockstep");
      assert.equal(lockstep.length, 0, "zod (non-protocol peer) should not trigger lockstep");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when gui-chat-protocol peer lower bound major.minor matches launcher pin", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: {
          "@mulmoclaude/foo-plugin": "^0.1.5",
          "gui-chat-protocol": "1.5.0",
        },
      },
      workspaces: [
        {
          dir: "packages/plugins/foo-plugin",
          pkg: { name: "@mulmoclaude/foo-plugin", version: "0.1.5", peerDependencies: { "gui-chat-protocol": "^1.5.0" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.deepEqual(findings, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Invariant-6 cases all have the same shape: one workspace package, one
// consumer declaring a range on it. Naming that shape keeps each `it` to the
// pair of versions under test and guarantees the temp repo is always removed.
async function auditConsumerPair(coreVersion: string, consumerRange: string, field: "peerDependencies" | "devDependencies" = "peerDependencies") {
  const root = makeFakeRepo({
    root: { name: "monorepo", dependencies: {} },
    launcher: { name: "mulmoclaude", dependencies: {} },
    workspaces: [
      { dir: "packages/core", pkg: { name: "@mulmoclaude/core", version: coreVersion } },
      {
        dir: "packages/plugins/foo-plugin",
        pkg: { name: "@mulmoclaude/foo-plugin", version: "1.0.0", [field]: { "@mulmoclaude/core": consumerRange } },
      },
    ],
  });
  try {
    return await sync.auditLauncherSync({ root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const consumerLockstepCount = (findings: { kind: string }[]) => findings.filter((finding) => finding.kind === "consumer-lockstep").length;

describe("auditLauncherSync — invariant 6: every manifest tracks its internal deps", () => {
  // The gap #3037 / #3038 were filed for. Three releases in a row bumped a
  // workspace package and swept only the launcher; the gate reported ONE
  // finding while 14 plugin peer/dev declarations stayed stale and unchecked.
  const staleConsumer = () => ({
    root: { name: "monorepo", dependencies: {} },
    launcher: { name: "mulmoclaude", dependencies: { "@mulmoclaude/core": "^4.7.0" } },
    workspaces: [
      { dir: "packages/core", pkg: { name: "@mulmoclaude/core", version: "4.7.0" } },
      {
        dir: "packages/plugins/foo-plugin",
        pkg: {
          name: "@mulmoclaude/foo-plugin",
          version: "1.0.0",
          peerDependencies: { "@mulmoclaude/core": "^4.6.0" },
          devDependencies: { "@mulmoclaude/core": "^4.6.0" },
        },
      },
    ],
  });

  it("catches a plugin's peer AND dev range left behind while the launcher is correct", async () => {
    const root = makeFakeRepo(staleConsumer());
    try {
      const findings = await sync.auditLauncherSync({ root });
      const consumer = findings.filter((finding) => finding.kind === "consumer-lockstep");
      assert.equal(consumer.length, 2, "both the peer and the dev declaration are stale");
      assert.ok(consumer.every((finding) => /foo-plugin.*4\.6\.0.*4\.7\.0/.test(finding.message)));
      assert.ok(
        consumer.some((finding) => finding.message.includes("peerDependencies")) && consumer.some((finding) => finding.message.includes("devDependencies")),
        "names which field is stale, so the sweep is mechanical",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stays silent once the consumer is swept", async () => {
    const fixture = staleConsumer();
    const plugin = fixture.workspaces.find((entry) => entry.pkg.name === "@mulmoclaude/foo-plugin");
    assert.ok(plugin, "fixture must contain the plugin whose ranges we are sweeping");
    plugin.pkg.peerDependencies = { "@mulmoclaude/core": "^4.7.0" };
    plugin.pkg.devDependencies = { "@mulmoclaude/core": "^4.7.0" };
    const root = makeFakeRepo(fixture);
    try {
      assert.deepEqual(await sync.auditLauncherSync({ root }), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a stale launcher dep once, not twice", async () => {
    // Invariant 4 already owns the launcher's `dependencies`. Reporting the
    // same drift from both rules would make one bad release read as two.
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: { "@mulmoclaude/core": "^4.6.0" } },
      workspaces: [{ dir: "packages/core", pkg: { name: "@mulmoclaude/core", version: "4.7.0" } }],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.equal(findings.filter((finding) => finding.kind === "workspace-lockstep").length, 1);
      assert.equal(findings.filter((finding) => finding.kind === "consumer-lockstep").length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores external deps and a package's own name", async () => {
    // Only workspace-internal edges are knowable from the tree; an external
    // range is the author's call and a self-reference is not an edge at all.
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: {} },
      workspaces: [
        {
          dir: "packages/plugins/foo-plugin",
          pkg: {
            name: "@mulmoclaude/foo-plugin",
            version: "1.0.0",
            dependencies: { vue: "^3.0.0", "@mulmoclaude/foo-plugin": "^0.0.1" },
          },
        },
      ],
    });
    try {
      assert.deepEqual(await sync.auditLauncherSync({ root }), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a prerelease workspace whose consumer range already matches", async () => {
    // Parsing drops the `-beta.1` suffix; comparing that against the raw
    // version string reported a correctly-swept prerelease as drift and would
    // block the very release commit that did the sweep.
    assert.deepEqual(await auditConsumerPair("4.8.0-beta.1", "^4.8.0-beta.1"), []);
  });

  it("flags a DIFFERENT prerelease with the same numeric tuple", async () => {
    // The trap in the first attempt at this fix: comparing numeric triples
    // makes `^4.8.0-beta.1` look synchronized with a workspace already at
    // `4.8.0-beta.2` — precisely the stale lower bound this invariant exists
    // to catch, waved through.
    assert.equal(consumerLockstepCount(await auditConsumerPair("4.8.0-beta.2", "^4.8.0-beta.1")), 1);
  });

  it("reads a prerelease-plus-build version rather than skipping it", async () => {
    // `4.8.0-beta.2+build.9` is valid SemVer, but the old suffix pattern
    // allowed a prerelease OR a build, not both. It parsed as nothing, the
    // edge became `skipped`, and `main()` drops skipped from the failure
    // count — so a stale range against such a version passed the gate.
    const findings = await auditConsumerPair("4.8.0-beta.2+build.9", "^4.8.0-beta.1+build.9");
    assert.equal(findings.filter((finding) => finding.kind === "skipped").length, 0, "a valid SemVer version must not be skipped");
    assert.equal(consumerLockstepCount(findings), 1, "and the stale range must be reported");
  });

  it("treats versions differing only in build metadata as the same release", async () => {
    // Build metadata is excluded from SemVer precedence, so these resolve to
    // the same release and reporting drift would be a false positive.
    assert.deepEqual(await auditConsumerPair("4.8.0-beta.1+build.2", "^4.8.0-beta.1+build.1"), []);
  });

  it("still flags a prerelease workspace the consumer has not caught up with", async () => {
    // The leniency above must not swallow real drift: the whole
    // comparator-stripped version is compared, so 4.7.0 vs 4.8.0-beta.1 is
    // still a finding.
    assert.equal(consumerLockstepCount(await auditConsumerPair("4.8.0-beta.1", "^4.7.0")), 1);
  });

  it("surfaces an unparseable consumer range as skipped, never as a failure", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: {} },
      workspaces: [
        { dir: "packages/core", pkg: { name: "@mulmoclaude/core", version: "4.7.0" } },
        {
          dir: "packages/plugins/foo-plugin",
          pkg: { name: "@mulmoclaude/foo-plugin", version: "1.0.0", dependencies: { "@mulmoclaude/core": "workspace:*" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.equal(findings.filter((finding) => finding.kind !== "skipped").length, 0, "a range we cannot parse must not fail the gate");
      assert.equal(findings.filter((finding) => finding.kind === "skipped").length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditLauncherSync — repo self-check", () => {
  it("finds no failing findings against the real repo (post PR #1921)", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const findings = await sync.auditLauncherSync({ root: repoRoot });
    const failing = findings.filter((finding) => finding.kind !== "skipped");
    const rendered = failing.map((finding) => `  [${finding.kind}] ${finding.message}`).join("\n");
    assert.deepEqual(failing, [], `Real repo has failing findings — root ↔ launcher out of sync:\n${rendered}`);
  });
});
