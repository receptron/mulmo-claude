import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractFetchError } from "../../server/utils/fetch.js";

function mockResponse(
  status: number,
  body: unknown,
  jsonThrows = false,
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (jsonThrows) throw new Error("not json");
      return body;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("extractFetchError", () => {
  it("extracts the error field from a JSON { error } body", async () => {
    const msg = await extractFetchError(
      mockResponse(400, { error: "bad request" }),
    );
    assert.equal(msg, "bad request");
  });

  it("falls back to HTTP status when body has no error field", async () => {
    const msg = await extractFetchError(mockResponse(500, { other: "field" }));
    assert.equal(msg, "HTTP 500");
  });

  it("falls back to HTTP status when json() throws", async () => {
    const msg = await extractFetchError(mockResponse(502, null, true));
    assert.equal(msg, "HTTP 502");
  });

  it("falls back to HTTP status for empty body", async () => {
    const msg = await extractFetchError(mockResponse(404, {}));
    assert.equal(msg, "HTTP 404");
  });
});
