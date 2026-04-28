import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendError, badRequest, forbidden, notFound, conflict, serverError } from "../../server/utils/httpError.ts";

// Minimal mock of the Express `Response` shape that our helpers
// actually touch (status + json). Record what was received so
// assertions can inspect the intended output.
interface RecordedResponse {
  status: number | null;
  body: unknown;
  statusCalled: boolean;
  jsonCalled: boolean;
}
interface MockResponse {
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
  _recorded: RecordedResponse;
}
function mockRes(): MockResponse {
  const recorded: RecordedResponse = {
    status: null,
    body: null,
    statusCalled: false,
    jsonCalled: false,
  };
  const res: MockResponse = {
    _recorded: recorded,
    status(code) {
      recorded.status = code;
      recorded.statusCalled = true;
      return this;
    },
    json(body) {
      recorded.body = body;
      recorded.jsonCalled = true;
      return this;
    },
  };
  return res;
}

// Cast once at the test boundary so the production signatures stay
// clean; tests always run against a structurally-compatible mock.
function asExpressRes(mock: MockResponse): Parameters<typeof sendError>[0] {
  return mock as unknown as Parameters<typeof sendError>[0];
}

describe("httpError helpers", () => {
  it("sendError sets the given status and { error } body", () => {
    const res = mockRes();
    sendError(asExpressRes(res), 418, "I'm a teapot");
    assert.equal(res._recorded.status, 418);
    assert.deepEqual(res._recorded.body, { error: "I'm a teapot" });
    assert.equal(res._recorded.statusCalled, true);
    assert.equal(res._recorded.jsonCalled, true);
  });

  it("badRequest sends 400", () => {
    const res = mockRes();
    badRequest(asExpressRes(res), "missing field");
    assert.equal(res._recorded.status, 400);
    assert.deepEqual(res._recorded.body, { error: "missing field" });
  });

  it("forbidden sends 403", () => {
    const res = mockRes();
    forbidden(asExpressRes(res), "no access");
    assert.equal(res._recorded.status, 403);
    assert.deepEqual(res._recorded.body, { error: "no access" });
  });

  it("notFound sends 404", () => {
    const res = mockRes();
    notFound(asExpressRes(res), "gone");
    assert.equal(res._recorded.status, 404);
    assert.deepEqual(res._recorded.body, { error: "gone" });
  });

  it("conflict sends 409", () => {
    const res = mockRes();
    conflict(asExpressRes(res), "already running");
    assert.equal(res._recorded.status, 409);
    assert.deepEqual(res._recorded.body, { error: "already running" });
  });

  it("serverError sends 500", () => {
    const res = mockRes();
    serverError(asExpressRes(res), "boom");
    assert.equal(res._recorded.status, 500);
    assert.deepEqual(res._recorded.body, { error: "boom" });
  });

  it("returns the response object so callers can inline `return`", () => {
    const res = mockRes();
    const returned = badRequest(asExpressRes(res), "x");
    // Structural mock returns itself from both status() and json(),
    // same as Express Response.
    assert.equal(returned, res);
  });
});
