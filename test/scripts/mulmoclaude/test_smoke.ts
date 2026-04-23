// Unit tests for the smoke driver's orchestration: fail-fast
// ordering, stage summaries, and skipTarball gating. The three
// underlying checks are injected as stubs so these tests don't
// spawn npm, bind ports, or touch the filesystem.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as smoke from "../../../scripts/mulmoclaude/smoke.mjs";

// Stub factories — keep them small so the setup is legible at a
// glance in each test.
function auditReturning(missing: string[]) {
  return async () => missing;
}

interface StubDriftResult {
  packageBaseName: string;
  localVersion: string | null;
  status: "ok" | "drifted" | "skipped";
}

function driftReturning(results: StubDriftResult[]) {
  return async () => results;
}

function tarballReturning(overrides: Partial<{ ok: boolean; port: number; attempts: number; elapsedMs: number; lastError: string | null }> = {}) {
  const stub = async () => ({
    ok: overrides.ok ?? true,
    port: overrides.port ?? 3001,
    attempts: overrides.attempts ?? 1,
    elapsedMs: overrides.elapsedMs ?? 250,
    lastError: overrides.lastError ?? null,
    tarballPath: "/tmp/mulmoclaude-0.0.0.tgz",
    workDir: "/tmp/mc-smoke-test",
    logFile: "/tmp/mc-smoke-test/launcher.log",
  });
  return stub;
}

// Wrap a stub so tests can assert it wasn't invoked (used for the
// fail-fast ordering checks — no need for a typed return value,
// just a callable-with-counter).
function spyOnTarball(): { stub: ReturnType<typeof tarballReturning>; callCount: () => number } {
  let calls = 0;
  const inner = tarballReturning({ ok: true });
  const stub = (async (...args: Parameters<typeof inner>) => {
    calls += 1;
    return inner(...args);
  }) as ReturnType<typeof tarballReturning>;
  return { stub, callCount: () => calls };
}

describe("runSmoke — happy path", () => {
  it("runs all three stages when each returns ok", async () => {
    const result = await smoke.runSmoke({
      auditFn: auditReturning([]),
      driftFn: driftReturning([{ packageBaseName: "protocol", localVersion: "0.1.3", status: "ok" }]),
      tarballFn: tarballReturning({ ok: true }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.stages.map((stage) => stage.name),
      ["deps", "drift", "tarball"],
    );
    for (const stage of result.stages) assert.equal(stage.ok, true, `${stage.name} should be ok`);
  });

  it("surfaces the HTTP port in the tarball stage summary", async () => {
    const result = await smoke.runSmoke({
      auditFn: auditReturning([]),
      driftFn: driftReturning([]),
      tarballFn: tarballReturning({ ok: true, port: 41_234, attempts: 2, elapsedMs: 1200 }),
    });
    const tarballStage = result.stages.find((stage) => stage.name === "tarball");
    assert.match(tarballStage?.summary ?? "", /41234/);
    assert.match(tarballStage?.summary ?? "", /2 attempt\(s\)/);
  });
});

describe("runSmoke — fail-fast ordering", () => {
  it("stops after deps fails — drift + tarball never run", async () => {
    let driftCalls = 0;
    const tarballSpy = spyOnTarball();
    const result = await smoke.runSmoke({
      auditFn: auditReturning(["mammoth", "puppeteer"]),
      driftFn: async () => {
        driftCalls += 1;
        return [];
      },
      tarballFn: tarballSpy.stub,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stages.length, 1);
    assert.equal(result.stages[0].name, "deps");
    assert.equal(driftCalls, 0, "drift must not run when deps failed");
    assert.equal(tarballSpy.callCount(), 0, "tarball must not run when deps failed");
    assert.deepEqual(result.stages[0].details.missing, ["mammoth", "puppeteer"]);
  });

  it("stops after drift fails — tarball never runs", async () => {
    const tarballSpy = spyOnTarball();
    const result = await smoke.runSmoke({
      auditFn: auditReturning([]),
      driftFn: driftReturning([
        { packageBaseName: "protocol", localVersion: "0.1.3", status: "drifted" },
        { packageBaseName: "client", localVersion: "0.1.2", status: "ok" },
      ]),
      tarballFn: tarballSpy.stub,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stages.length, 2);
    assert.equal(result.stages[1].name, "drift");
    assert.equal(tarballSpy.callCount(), 0, "tarball must not run when drift failed");
    assert.deepEqual(result.stages[1].details.drifted, ["protocol"]);
  });

  it("reports tarball failure with the lastError from the smoke result", async () => {
    const result = await smoke.runSmoke({
      auditFn: auditReturning([]),
      driftFn: driftReturning([]),
      tarballFn: tarballReturning({ ok: false, lastError: "ECONNREFUSED" }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.stages.length, 3);
    assert.equal(result.stages[2].name, "tarball");
    assert.match(result.stages[2].summary, /ECONNREFUSED/);
  });
});

describe("runSmoke — skipTarball", () => {
  it("returns ok without running the tarball stage", async () => {
    const tarballSpy = spyOnTarball();
    const result = await smoke.runSmoke({
      auditFn: auditReturning([]),
      driftFn: driftReturning([]),
      tarballFn: tarballSpy.stub,
      skipTarball: true,
    });
    assert.equal(result.ok, true);
    assert.equal(tarballSpy.callCount(), 0);
    assert.deepEqual(
      result.stages.map((stage) => stage.name),
      ["deps", "drift"],
    );
  });

  it("still fails fast on deps even with skipTarball", async () => {
    const result = await smoke.runSmoke({
      auditFn: auditReturning(["something"]),
      driftFn: driftReturning([]),
      tarballFn: tarballReturning({ ok: true }),
      skipTarball: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stages.length, 1);
  });
});

describe("runSmoke — drift classification", () => {
  it("counts skipped packages separately and still reports ok", async () => {
    const result = await smoke.runSmoke({
      auditFn: auditReturning([]),
      driftFn: driftReturning([
        { packageBaseName: "protocol", localVersion: "0.1.3", status: "ok" },
        { packageBaseName: "client", localVersion: "0.1.2", status: "skipped" },
        { packageBaseName: "chat-service", localVersion: "0.1.1", status: "ok" },
      ]),
      skipTarball: true,
    });
    assert.equal(result.ok, true);
    const driftStage = result.stages.find((stage) => stage.name === "drift");
    assert.match(driftStage?.summary ?? "", /2 package\(s\) ok/);
    assert.match(driftStage?.summary ?? "", /1 skipped/);
  });
});
