// The sibling per-minute limiter has tests; this in-flight cap shipped without
// any. It is the guard that keeps a runaway dashboard loop from stacking
// concurrent full-file DuckDB scans, and every failure mode is a leak: a slot
// that never comes back permanently 429s the collection, a slot released twice
// lets the cap drift upward without bound.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Request, Response, NextFunction } from "express";
import { makeViewQueryConcurrencyGuard } from "../../../server/api/routes/collections.js";

/** A real `EventEmitter` backs the `close` event rather than a handler array.
 *  Express's `Response` IS an emitter, so `once` must actually deregister after
 *  the first emit — a stub that re-invokes handlers on every emit lets a test
 *  assert behaviour that cannot happen in production (Codex review). */
function closeEvents() {
  const emitter = new EventEmitter();
  return {
    subscribeOnce: (event: string, handler: () => void): void => void emitter.once(event, handler),
    emitClose: (): void => void emitter.emit("close"),
  };
}

interface ResponseState {
  statusCode: number;
  body: unknown;
}

function fakeRes() {
  const state: ResponseState = { statusCode: 0, body: undefined };
  const events = closeEvents();
  const res = {
    status: (code: number) => {
      state.statusCode = code;
      return res;
    },
    json: (payload: unknown) => {
      state.body = payload;
      return res;
    },
    once: (event: string, handler: () => void) => {
      events.subscribeOnce(event, handler);
      return res;
    },
  } as unknown as Response;
  return { res, status: () => state.statusCode, body: () => state.body, close: events.emitClose };
}

const request = (slug?: string) => ({ params: slug === undefined ? {} : { slug } }) as unknown as Request<{ slug?: string }>;

function call(guard: ReturnType<typeof makeViewQueryConcurrencyGuard>, slug?: string) {
  const { res, status, body, close } = fakeRes();
  let nexted = false;
  guard(request(slug), res, (() => {
    nexted = true;
  }) as NextFunction);
  return { nexted, status: status(), body: body(), close };
}

describe("makeViewQueryConcurrencyGuard", () => {
  it("passes requests up to the cap", () => {
    const guard = makeViewQueryConcurrencyGuard(2);
    assert.equal(call(guard, "tasks").nexted, true);
    assert.equal(call(guard, "tasks").nexted, true);
  });

  it("429s the request that exceeds the cap", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    call(guard, "tasks");
    const over = call(guard, "tasks");
    assert.equal(over.nexted, false);
    assert.equal(over.status, 429);
    assert.deepEqual(over.body, { error: "too many concurrent queries for this collection — retry shortly" });
  });

  it("returns the slot when the response closes", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    const first = call(guard, "tasks");
    assert.equal(call(guard, "tasks").nexted, false);
    first.close();
    assert.equal(call(guard, "tasks").nexted, true);
  });

  // `close` can be emitted more than once (response finish, then a client
  // disconnect). One emitted event must free exactly one slot, or the cap
  // drifts upward and lets extra concurrent scans through. Two mechanisms
  // uphold that together: `once` deregisters the listener, and the guard's own
  // `released` latch. Neither alone is asserted here — the invariant is.
  //
  // Detecting a violation needs a second request still in flight: with the
  // counter already at zero, a stray release is absorbed by the guard's `?? 1`
  // fallback and looks identical to the correct behaviour.
  it("frees exactly one slot even if close is emitted twice", () => {
    const guard = makeViewQueryConcurrencyGuard(2);
    const stillRunning = call(guard, "tasks");
    const finished = call(guard, "tasks");
    finished.close();
    finished.close();
    assert.equal(call(guard, "tasks").nexted, true, "the finished request's slot comes back");
    assert.equal(call(guard, "tasks").nexted, false, "the still-running request's slot must NOT have been freed too");
    stillRunning.close();
  });

  it("counts each slug independently", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    assert.equal(call(guard, "tasks").nexted, true);
    assert.equal(call(guard, "notes").nexted, true);
    assert.equal(call(guard, "tasks").nexted, false);
  });

  // A 429 never took a slot, so it must not release one either — otherwise a
  // burst of rejections would free capacity the in-flight scans still hold.
  it("does not let a rejected request return a slot", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    const held = call(guard, "tasks");
    const rejected = call(guard, "tasks");
    assert.equal(rejected.nexted, false);
    rejected.close();
    assert.equal(call(guard, "tasks").nexted, false);
    held.close();
    assert.equal(call(guard, "tasks").nexted, true);
  });

  it("treats a missing slug param as its own bucket rather than throwing", () => {
    const guard = makeViewQueryConcurrencyGuard(1);
    assert.equal(call(guard).nexted, true);
    assert.equal(call(guard).nexted, false);
    assert.equal(call(guard, "tasks").nexted, true);
  });

  // Every request is over the cap, so none should ever reach the handler.
  it("rejects everything when the cap is zero", () => {
    const guard = makeViewQueryConcurrencyGuard(0);
    const first = call(guard, "tasks");
    assert.equal(first.nexted, false);
    assert.equal(first.status, 429);
  });

  it("recovers full capacity after all in-flight requests close", () => {
    const guard = makeViewQueryConcurrencyGuard(2);
    const firstScan = call(guard, "tasks");
    const secondScan = call(guard, "tasks");
    assert.equal(call(guard, "tasks").nexted, false);
    firstScan.close();
    secondScan.close();
    assert.equal(call(guard, "tasks").nexted, true);
    assert.equal(call(guard, "tasks").nexted, true);
    assert.equal(call(guard, "tasks").nexted, false);
  });
});
