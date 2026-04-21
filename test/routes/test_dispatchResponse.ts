import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import { respondWithDispatchResult, type DispatchResult } from "../../server/api/routes/dispatchResponse.js";

// Minimal Response mock that records the status + JSON body the
// helper writes. We don't pull in supertest because the helper is a
// pure function over (response, result, options) — no routing needed.
interface RecordedResponse {
  statusCode: number;
  body: unknown;
  status(code: number): RecordedResponse;
  json(payload: unknown): RecordedResponse;
}

function makeRes(): RecordedResponse {
  const rec: RecordedResponse = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return rec;
}

interface Item {
  id: string;
  value: number;
}

const ITEMS: Item[] = [
  { id: "a", value: 1 },
  { id: "b", value: 2 },
];

describe("respondWithDispatchResult — error result", () => {
  it("writes the dispatch error status and body", () => {
    const res = makeRes();
    const result: DispatchResult<Item> = {
      kind: "error",
      status: 400,
      error: "bad request",
    };
    let persistCalled = false;
    respondWithDispatchResult(res as unknown as Response, result, {
      shouldPersist: true,
      instructions: "should not be sent",
      persist: () => {
        persistCalled = true;
      },
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "bad request" });
    assert.equal(persistCalled, false, "persist must not run on error");
  });

  it("preserves the dispatch error status (e.g. 404)", () => {
    const res = makeRes();
    respondWithDispatchResult(
      res as unknown as Response,
      { kind: "error", status: 404, error: "not found" },
      {
        shouldPersist: false,
        instructions: "x",
        persist: () => {},
      },
    );
    assert.equal(res.statusCode, 404);
  });
});

describe("respondWithDispatchResult — success result", () => {
  it("writes the success body without persisting when shouldPersist is false", () => {
    const res = makeRes();
    let persistCalled = false;
    respondWithDispatchResult<Item>(
      res as unknown as Response,
      {
        kind: "success",
        items: ITEMS,
        message: "ok",
        jsonData: { count: 2 },
      },
      {
        shouldPersist: false,
        instructions: "render the list",
        persist: () => {
          persistCalled = true;
        },
      },
    );
    assert.equal(persistCalled, false);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      data: { items: ITEMS },
      message: "ok",
      jsonData: { count: 2 },
      instructions: "render the list",
      updating: true,
    });
  });

  it("calls persist with the result items when shouldPersist is true", () => {
    const res = makeRes();
    let persistedItems: Item[] | null = null;
    respondWithDispatchResult<Item>(
      res as unknown as Response,
      {
        kind: "success",
        items: ITEMS,
        message: "saved",
        jsonData: {},
      },
      {
        shouldPersist: true,
        instructions: "render",
        persist: (items) => {
          persistedItems = items;
        },
      },
    );
    assert.deepEqual(persistedItems, ITEMS);
    assert.equal(res.statusCode, 200);
  });

  it("always sets updating: true on the success response", () => {
    const res = makeRes();
    respondWithDispatchResult<Item>(
      res as unknown as Response,
      {
        kind: "success",
        items: [],
        message: "",
        jsonData: {},
      },
      {
        shouldPersist: false,
        instructions: "x",
        persist: () => {},
      },
    );
    const body = res.body as { updating: boolean };
    assert.equal(body.updating, true);
  });
});

describe("respondWithDispatchResult — persist throws", () => {
  it("translates a persist throw into a 500 JSON error response", () => {
    const res = makeRes();
    respondWithDispatchResult<Item>(
      res as unknown as Response,
      {
        kind: "success",
        items: ITEMS,
        message: "ok",
        jsonData: {},
      },
      {
        shouldPersist: true,
        instructions: "x",
        persist: () => {
          throw new Error("disk full");
        },
      },
    );
    assert.equal(res.statusCode, 500);
    const body = res.body as { error: string };
    assert.match(body.error, /Failed to persist changes/);
    assert.match(body.error, /disk full/);
  });

  it("does not write the success body when persist throws", () => {
    const res = makeRes();
    respondWithDispatchResult<Item>(
      res as unknown as Response,
      {
        kind: "success",
        items: ITEMS,
        message: "should not appear",
        jsonData: {},
      },
      {
        shouldPersist: true,
        instructions: "should not appear",
        persist: () => {
          throw new Error("nope");
        },
      },
    );
    const body = res.body as Record<string, unknown>;
    assert.equal(body.message, undefined);
    assert.equal(body.instructions, undefined);
    assert.equal(body.updating, undefined);
    assert.ok(body.error);
  });

  it("handles a persist throw with a non-Error value", () => {
    const res = makeRes();
    respondWithDispatchResult<Item>(
      res as unknown as Response,
      {
        kind: "success",
        items: ITEMS,
        message: "ok",
        jsonData: {},
      },
      {
        shouldPersist: true,
        instructions: "x",
        persist: () => {
          throw "string thrown directly";
        },
      },
    );
    assert.equal(res.statusCode, 500);
    const body = res.body as { error: string };
    assert.match(body.error, /string thrown directly/);
  });
});
