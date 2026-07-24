// `resolveCatalogTarget` is the shared preamble of the catalog preview and
// star endpoints (#2367). The messages it sends are API response bodies, so
// every case below pins the exact status AND wording — a "clearer" rewrite of
// one of these strings is a breaking change, not a cleanup.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCatalogTarget } from "../../../server/api/routes/skillCatalogTarget.js";

// Minimal stand-in for the Express `Response` shape the helper touches
// (status + json), recording what it received — same pattern as
// test/utils/test_httpError.ts.
interface RecordedResponse {
  status: number | null;
  body: unknown;
  jsonCalled: boolean;
}
interface MockResponse {
  status: (code: number) => MockResponse;
  json: (body: unknown) => MockResponse;
  _recorded: RecordedResponse;
}
function mockRes(): MockResponse {
  const recorded: RecordedResponse = { status: null, body: null, jsonCalled: false };
  const res: MockResponse = {
    _recorded: recorded,
    status(code) {
      recorded.status = code;
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

// Cast once at the test boundary so the production signature stays clean.
function asExpressRes(mock: MockResponse): Parameters<typeof resolveCatalogTarget>[2] {
  return mock as unknown as Parameters<typeof resolveCatalogTarget>[2];
}

function assertRejected(res: MockResponse, message: string): void {
  assert.equal(res._recorded.status, 400);
  assert.deepEqual(res._recorded.body, { error: message });
}

const UNKNOWN_SOURCE = "source must be a known catalog source";
const MISSING_SLUG = "slug is required";
const missingExternalArgs = (action: string) => `repoId and skillFolder are required for external ${action}`;

describe("resolveCatalogTarget — source validation", () => {
  it("rejects an unknown source", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "anthropic", slug: "mc-foo" }, "preview", asExpressRes(res)), null);
    assertRejected(res, UNKNOWN_SOURCE);
  });

  it("rejects a missing source", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ slug: "mc-foo" }, "preview", asExpressRes(res)), null);
    assertRejected(res, UNKNOWN_SOURCE);
  });

  it("rejects a repeated query param, which arrives as an array", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: ["preset", "external"], slug: "mc-foo" }, "preview", asExpressRes(res)), null);
    assertRejected(res, UNKNOWN_SOURCE);
  });

  it("rejects an empty-string source", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "" }, "star", asExpressRes(res)), null);
    assertRejected(res, UNKNOWN_SOURCE);
  });

  it("rejects a non-string source", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: 123 }, "star", asExpressRes(res)), null);
    assertRejected(res, UNKNOWN_SOURCE);
  });
});

describe("resolveCatalogTarget — external arguments", () => {
  it("rejects an empty repoId", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "external", repoId: "", skillFolder: "pptx" }, "preview", asExpressRes(res)), null);
    assertRejected(res, missingExternalArgs("preview"));
  });

  it("rejects a non-string repoId", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "external", repoId: 42, skillFolder: "pptx" }, "preview", asExpressRes(res)), null);
    assertRejected(res, missingExternalArgs("preview"));
  });

  it("rejects an array repoId, which is what a repeated query param gives", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "external", repoId: ["a", "b"], skillFolder: "pptx" }, "preview", asExpressRes(res)), null);
    assertRejected(res, missingExternalArgs("preview"));
  });

  it("rejects an empty skillFolder", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "external", repoId: "anthropics-skills", skillFolder: "" }, "star", asExpressRes(res)), null);
    assertRejected(res, missingExternalArgs("star"));
  });

  it("rejects a non-string skillFolder", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "external", repoId: "anthropics-skills", skillFolder: null }, "star", asExpressRes(res)), null);
    assertRejected(res, missingExternalArgs("star"));
  });

  it("rejects both arguments missing", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "external" }, "preview", asExpressRes(res)), null);
    assertRejected(res, missingExternalArgs("preview"));
  });

  it("ignores a slug when the source is external", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "external", slug: "mc-foo" }, "star", asExpressRes(res)), null);
    assertRejected(res, missingExternalArgs("star"));
  });

  it("resolves a valid external pair without responding", () => {
    const res = mockRes();
    const target = resolveCatalogTarget({ source: "external", repoId: "anthropics-skills", skillFolder: "pptx" }, "preview", asExpressRes(res));
    assert.deepEqual(target, { kind: "external", source: "external", repoId: "anthropics-skills", skillFolder: "pptx" });
    assert.equal(res._recorded.jsonCalled, false);
  });

  it("keeps a whitespace-only repoId — the guard is length-based, not trim-based, and these endpoints have always accepted it", () => {
    const res = mockRes();
    const target = resolveCatalogTarget({ source: "external", repoId: " ", skillFolder: " " }, "preview", asExpressRes(res));
    assert.deepEqual(target, { kind: "external", source: "external", repoId: " ", skillFolder: " " });
    assert.equal(res._recorded.jsonCalled, false);
  });
});

describe("resolveCatalogTarget — non-external slug", () => {
  it("rejects an empty slug", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "preset", slug: "" }, "preview", asExpressRes(res)), null);
    assertRejected(res, MISSING_SLUG);
  });

  it("rejects a missing slug", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "preset" }, "star", asExpressRes(res)), null);
    assertRejected(res, MISSING_SLUG);
  });

  it("rejects a non-string slug", () => {
    const res = mockRes();
    assert.equal(resolveCatalogTarget({ source: "preset", slug: ["mc-foo"] }, "star", asExpressRes(res)), null);
    assertRejected(res, MISSING_SLUG);
  });

  it("resolves a valid preset target without responding", () => {
    const res = mockRes();
    const target = resolveCatalogTarget({ source: "preset", slug: "mc-foo" }, "star", asExpressRes(res));
    assert.deepEqual(target, { kind: "catalog", source: "preset", slug: "mc-foo" });
    assert.equal(res._recorded.jsonCalled, false);
  });

  it("ignores external arguments when the source is not external", () => {
    const res = mockRes();
    const target = resolveCatalogTarget({ source: "preset", slug: "mc-foo", repoId: "", skillFolder: "" }, "preview", asExpressRes(res));
    assert.deepEqual(target, { kind: "catalog", source: "preset", slug: "mc-foo" });
    assert.equal(res._recorded.jsonCalled, false);
  });
});

describe("resolveCatalogTarget — action wording", () => {
  it("says preview for the preview endpoint and star for the star endpoint", () => {
    const previewRes = mockRes();
    resolveCatalogTarget({ source: "external" }, "preview", asExpressRes(previewRes));
    assertRejected(previewRes, "repoId and skillFolder are required for external preview");

    const starRes = mockRes();
    resolveCatalogTarget({ source: "external" }, "star", asExpressRes(starRes));
    assertRejected(starRes, "repoId and skillFolder are required for external star");
  });
});
