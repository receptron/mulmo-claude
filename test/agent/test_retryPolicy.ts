// A replay re-runs a turn, so a false positive here re-executes side effects
// the user already paid for. These tests pin the two things that keep that from
// happening: only `error` events with the exact CLI phrasing classify, and a
// budget of zero refuses regardless of the message.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectRecovery, isRecoverableBrokerNotReady, isRecoverableStaleSession, abortableSleep } from "../../server/agent/retryPolicy.js";
import { EVENT_TYPES } from "../../src/types/events.js";

const STALE_MESSAGE = "No conversation found with session ID abc-123";
const BROKER_MESSAGE = "MCP tool mcp__mulmoclaude__handlePermission (passed via --permission-prompt-tool) not found. Available MCP tools: x";

const errorEvent = (message: unknown) => ({ type: EVENT_TYPES.error, message });

describe("isRecoverableStaleSession", () => {
  it("classifies a stale-resume error while budget remains", () => {
    assert.equal(isRecoverableStaleSession(errorEvent(STALE_MESSAGE), 1), true);
  });

  it("refuses once the budget is exhausted", () => {
    assert.equal(isRecoverableStaleSession(errorEvent(STALE_MESSAGE), 0), false);
  });

  it("refuses a negative budget", () => {
    assert.equal(isRecoverableStaleSession(errorEvent(STALE_MESSAGE), -1), false);
  });

  it("refuses a non-error event carrying the same text", () => {
    assert.equal(isRecoverableStaleSession({ type: EVENT_TYPES.text, message: STALE_MESSAGE }, 1), false);
  });

  it("refuses an unrelated error message", () => {
    assert.equal(isRecoverableStaleSession(errorEvent("ENOENT: no such file or directory"), 1), false);
  });

  it("refuses an empty message", () => {
    assert.equal(isRecoverableStaleSession(errorEvent(""), 1), false);
  });

  it("refuses a non-string message", () => {
    assert.equal(isRecoverableStaleSession(errorEvent({ text: STALE_MESSAGE }), 1), false);
    assert.equal(isRecoverableStaleSession(errorEvent(undefined), 1), false);
    assert.equal(isRecoverableStaleSession(errorEvent(null), 1), false);
  });
});

describe("isRecoverableBrokerNotReady", () => {
  it("classifies the broker startup race while budget remains", () => {
    assert.equal(isRecoverableBrokerNotReady(errorEvent(BROKER_MESSAGE), 1), true);
  });

  it("refuses once the budget is exhausted", () => {
    assert.equal(isRecoverableBrokerNotReady(errorEvent(BROKER_MESSAGE), 0), false);
  });

  // The phrase must match contiguously: a replay re-runs work, so an unrelated
  // "not found" plus a stray flag echo elsewhere in stderr must not trigger it.
  it("refuses a scattered near-match", () => {
    const scattered = "--permission-prompt-tool was passed. Later: skill 'foo' not found.";
    assert.equal(isRecoverableBrokerNotReady(errorEvent(scattered), 1), false);
  });

  it("refuses a bare not-found error", () => {
    assert.equal(isRecoverableBrokerNotReady(errorEvent("HTTP 404 not found"), 1), false);
  });

  it("refuses a non-error event carrying the same text", () => {
    assert.equal(isRecoverableBrokerNotReady({ type: EVENT_TYPES.status, message: BROKER_MESSAGE }, 1), false);
  });
});

describe("detectRecovery", () => {
  it("returns null when nothing matches", () => {
    assert.equal(detectRecovery(errorEvent("some other failure"), { stale: 3, broker: 3 }), null);
  });

  it("returns the kind that matches", () => {
    assert.equal(detectRecovery(errorEvent(STALE_MESSAGE), { stale: 1, broker: 1 }), "stale");
    assert.equal(detectRecovery(errorEvent(BROKER_MESSAGE), { stale: 1, broker: 1 }), "broker");
  });

  // Budgets are independent: the broker race hits fresh sessions too, so
  // spending the `--resume` budget must not disable broker recovery.
  it("still detects the broker race with the stale budget exhausted", () => {
    assert.equal(detectRecovery(errorEvent(BROKER_MESSAGE), { stale: 0, broker: 1 }), "broker");
  });

  it("still detects a stale session with the broker budget exhausted", () => {
    assert.equal(detectRecovery(errorEvent(STALE_MESSAGE), { stale: 1, broker: 0 }), "stale");
  });

  it("returns null when both budgets are exhausted", () => {
    assert.equal(detectRecovery(errorEvent(STALE_MESSAGE), { stale: 0, broker: 0 }), null);
    assert.equal(detectRecovery(errorEvent(BROKER_MESSAGE), { stale: 0, broker: 0 }), null);
  });
});

// Racing against a deadline is what actually distinguishes "the abort cut the
// wait short" from "the test just awaited a 60s timer" — a bare await passes
// either way.
const PATIENCE_MS = 500;
const raceAgainstDeadline = (waited: Promise<void>): Promise<string> =>
  Promise.race([waited.then(() => "slept"), new Promise<string>((resolve) => setTimeout(() => resolve("deadline"), PATIENCE_MS))]);

describe("abortableSleep", () => {
  it("resolves after the delay when never aborted", async () => {
    assert.equal(await raceAgainstDeadline(abortableSleep(1, new AbortController().signal)), "slept");
  });

  // A stop during the pause must end it promptly rather than let a doomed
  // replay spawn after the user already cancelled.
  it("resolves immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(await raceAgainstDeadline(abortableSleep(60_000, controller.signal)), "slept");
  });

  it("resolves as soon as the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const waited = abortableSleep(60_000, controller.signal);
    controller.abort();
    assert.equal(await raceAgainstDeadline(waited), "slept");
  });
});
