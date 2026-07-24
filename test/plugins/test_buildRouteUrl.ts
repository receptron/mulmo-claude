import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRouteUrl } from "../../src/plugins/meta-types.js";
import type { ResolvedRoute } from "../../src/plugins/meta-types.js";

const route = (url: string): ResolvedRoute => ({ method: "GET", url });

describe("buildRouteUrl", () => {
  it("returns the url unchanged without params", () => {
    assert.equal(buildRouteUrl(route("/api/x/:id")), "/api/x/:id");
  });

  it("substitutes a single param", () => {
    assert.equal(buildRouteUrl(route("/api/tasks/:id"), { id: "abc" }), "/api/tasks/abc");
  });

  it("URL-encodes values so separators and injections survive intact", () => {
    assert.equal(buildRouteUrl(route("/api/x/:id"), { id: "a b" }), "/api/x/a%20b");
    assert.equal(buildRouteUrl(route("/api/x/:id"), { id: "a/b" }), "/api/x/a%2Fb");
    assert.equal(buildRouteUrl(route("/api/x/:id"), { id: "a?injection=1" }), "/api/x/a%3Finjection%3D1");
    assert.equal(buildRouteUrl(route("/api/x/:id"), { id: "さくら" }), "/api/x/%E3%81%95%E3%81%8F%E3%82%89");
  });

  it("accepts number values", () => {
    assert.equal(buildRouteUrl(route("/api/x/:page"), { page: 3 }), "/api/x/3");
  });

  it("substitutes multiple params", () => {
    assert.equal(buildRouteUrl(route("/api/x/:a/:b"), { a: "1", b: "2" }), "/api/x/1/2");
  });

  // Regression: per-param split/join let the `id` substitution consume the
  // `:id` prefix of `:idx`, producing "/api/x/1/1x".
  it("never lets one param rewrite a longer placeholder it prefixes", () => {
    assert.equal(buildRouteUrl(route("/api/x/:id/:idx"), { id: "1", idx: "2" }), "/api/x/1/2");
    assert.equal(buildRouteUrl(route("/api/x/:idx/:id"), { idx: "2", id: "1" }), "/api/x/2/1");
  });

  it("ignores params that have no placeholder", () => {
    assert.equal(buildRouteUrl(route("/api/x/:id"), { id: "1", other: "9" }), "/api/x/1");
  });

  it("leaves a placeholder literal when its param is missing", () => {
    assert.equal(buildRouteUrl(route("/api/x/:id/:idx"), { id: "1" }), "/api/x/1/:idx");
  });

  it("substitutes an empty-string value as an empty segment", () => {
    assert.equal(buildRouteUrl(route("/api/x/:id"), { id: "" }), "/api/x/");
  });

  it("never reads a placeholder value off Object.prototype", () => {
    assert.equal(buildRouteUrl(route("/api/x/:constructor"), {}), "/api/x/:constructor");
  });
});
