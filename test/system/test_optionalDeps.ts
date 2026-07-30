import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { probeOne, probeOptionalDeps, depStatus, optionalDeps, _resetOptionalDepsCacheForTest, type OptionalDep } from "../../server/system/optionalDeps.js";

const present = async () => true;
const absent = async () => false;

describe("probeOne — reason mapping + override precedence", () => {
  it("reports not-on-path when the binary is absent (probe never consulted)", async () => {
    let probeCalled = false;
    const dep: OptionalDep = {
      id: "x",
      command: "x",
      enables: "x",
      probe: async () => {
        probeCalled = true;
        return true;
      },
    };
    const status = await probeOne(dep, absent);
    assert.deepEqual(status, { id: "x", available: false, reason: "not-on-path" });
    assert.equal(probeCalled, false, "liveness probe must not run when the binary is not on PATH");
  });

  it("reports probe-failed when on PATH but the liveness override returns false", async () => {
    const dep: OptionalDep = { id: "docker", command: "docker", enables: "dockerSandbox", probe: absent };
    const status = await probeOne(dep, present);
    assert.deepEqual(status, { id: "docker", available: false, reason: "probe-failed" });
  });

  it("reports ok when on PATH and the override passes", async () => {
    const dep: OptionalDep = { id: "docker", command: "docker", enables: "dockerSandbox", probe: present };
    assert.deepEqual(await probeOne(dep, present), { id: "docker", available: true, reason: "ok" });
  });

  it("reports ok when on PATH and there is no override", async () => {
    const dep: OptionalDep = { id: "ffmpeg", command: "ffmpeg", enables: "mulmocast" };
    assert.deepEqual(await probeOne(dep, present), { id: "ffmpeg", available: true, reason: "ok" });
  });

  it("accepts any executable that provides the same capability", async () => {
    const checked: string[] = [];
    const dep: OptionalDep = {
      id: "sandbox",
      command: "container / docker",
      commands: ["container", "docker"],
      enables: "sandbox",
    };
    const status = await probeOne(dep, async (command) => {
      checked.push(command);
      return command === "docker";
    });
    assert.deepEqual(status, { id: "sandbox", available: true, reason: "ok" });
    assert.deepEqual(checked, ["container", "docker"]);
  });

  it("never throws when the PATH check itself throws (degrades, not crashes)", async () => {
    const dep: OptionalDep = { id: "x", command: "x", enables: "x" };
    const throwing = async () => {
      throw new Error("corrupt PATH");
    };
    const status = await probeOne(dep, throwing);
    assert.deepEqual(status, { id: "x", available: false, reason: "probe-failed" });
  });

  it("never throws when the liveness override throws", async () => {
    const dep: OptionalDep = {
      id: "docker",
      command: "docker",
      enables: "dockerSandbox",
      probe: async () => {
        throw new Error("daemon socket error");
      },
    };
    const status = await probeOne(dep, present);
    assert.deepEqual(status, { id: "docker", available: false, reason: "probe-failed" });
  });
});

describe("registry", () => {
  it("declares the container sandbox (with liveness override) and ffmpeg (plain PATH)", () => {
    const byId = Object.fromEntries(optionalDeps().map((dep) => [dep.id, dep]));
    assert.ok(byId.docker, "docker entry present");
    assert.equal(typeof byId.docker?.probe, "function", "docker has a liveness override");
    assert.ok(byId.docker?.commands?.includes("docker"));
    if (process.platform === "darwin") assert.ok(byId.docker?.commands?.includes("container"));
    assert.ok(byId.ffmpeg, "ffmpeg entry present");
    assert.equal(byId.ffmpeg?.probe, undefined, "ffmpeg uses the default PATH check");
  });
});

describe("probeOptionalDeps — caching", () => {
  afterEach(() => _resetOptionalDepsCacheForTest());

  it("returns the same cached object across calls and exposes it via depStatus()", async () => {
    const first = await probeOptionalDeps();
    const second = await probeOptionalDeps();
    assert.equal(first, second, "second call returns the cached reference, no re-probe");
    for (const dep of optionalDeps()) {
      assert.equal(depStatus(dep.id)?.id, dep.id, `depStatus('${dep.id}') is readable after probe`);
    }
  });

  it("depStatus() is undefined before the first probe completes", async () => {
    _resetOptionalDepsCacheForTest();
    assert.equal(depStatus("ffmpeg"), undefined, "no status until probeOptionalDeps() resolves");
    await probeOptionalDeps();
    assert.notEqual(depStatus("ffmpeg"), undefined, "status populated after probe");
  });

  it("concurrent callers share one in-flight probe", async () => {
    _resetOptionalDepsCacheForTest();
    const [run1, run2, run3] = await Promise.all([probeOptionalDeps(), probeOptionalDeps(), probeOptionalDeps()]);
    assert.equal(run1, run2);
    assert.equal(run2, run3);
  });
});
