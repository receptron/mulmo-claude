import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { originKind, resultDotKind, nextEnabledState } from "../../../src/plugins/scheduler/taskDisplay.js";

describe("originKind", () => {
  it("maps the two known origins", () => {
    assert.equal(originKind("system"), "system");
    assert.equal(originKind("user"), "user");
  });

  it("falls back to skill for everything else", () => {
    assert.equal(originKind("skill"), "skill");
    assert.equal(originKind(""), "skill");
    assert.equal(originKind("SYSTEM"), "skill");
    assert.equal(originKind("garbage"), "skill");
  });
});

describe("resultDotKind", () => {
  it("maps success and error", () => {
    assert.equal(resultDotKind("success"), "success");
    assert.equal(resultDotKind("error"), "error");
  });

  it("falls back to other", () => {
    assert.equal(resultDotKind("running"), "other");
    assert.equal(resultDotKind(""), "other");
  });
});

describe("nextEnabledState", () => {
  it("disables an explicitly enabled task", () => {
    assert.equal(nextEnabledState(true), false);
  });

  it("enables a disabled task", () => {
    assert.equal(nextEnabledState(false), true);
  });

  // `undefined` means enabled, so the toggle must disable. A naive `!current`
  // would compute `!undefined === true` — a no-op re-enable. Pin the contrast.
  it("treats undefined as enabled and toggles it off", () => {
    const current: boolean | undefined = undefined;
    assert.equal(nextEnabledState(current), false);
    assert.equal(!current, true);
  });
});
