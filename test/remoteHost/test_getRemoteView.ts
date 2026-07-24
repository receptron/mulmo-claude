// Unit tests for the phase-3 remote custom-view surface: the shared
// buildRemoteView assembly (engine stubbed) and the getRemoteView command
// handler over it. See plans/done/feat-remote-custom-view.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { REMOTE_VIEW_MAX_BYTES } from "@mulmoclaude/core/remote-view";
import { createBuildRemoteView, remoteViewFailureMessage, type BuildRemoteViewDeps } from "../../server/workspace/collections/remoteView.js";
import { createGetRemoteView, type GetRemoteViewDeps } from "../../server/remoteHost/handlers/getRemoteView.js";
import { handlers } from "../../server/remoteHost/handlers/index.js";
import type { LoadedCollection } from "../../server/workspace/collections/index.js";

const HTML = "<html><head></head><body>phone view</body></html>";

const collection = (views: unknown[]): LoadedCollection =>
  ({
    slug: "plan",
    source: "project",
    skillDir: "/s/plan",
    dataDir: "/d/plan",
    schema: { primaryKey: "id", fields: {}, views },
  }) as unknown as LoadedCollection;

const mobileView = { id: "phone", label: "Phone", icon: "smartphone", target: "mobile" };

const buildDeps = (overrides: Partial<BuildRemoteViewDeps> = {}): BuildRemoteViewDeps => ({
  readCustomViewHtml: (async () => HTML) as unknown as BuildRemoteViewDeps["readCustomViewHtml"],
  readCustomViewI18n: (async () => ({ locale: "ja", dict: { hello: "こんにちは" } })) as unknown as BuildRemoteViewDeps["readCustomViewI18n"],
  ...overrides,
});

describe("createBuildRemoteView", () => {
  it("wraps a mobile view into the sandboxed srcdoc with byte count", async () => {
    const build = createBuildRemoteView(buildDeps());
    const result = await build(collection([{ ...mobileView, file: "views/phone.html" }]), "phone", "en");
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.view, { id: "phone", label: "Phone", icon: "smartphone", target: "mobile" });
    assert.match(result.srcdoc, /Content-Security-Policy/);
    assert.match(result.srcdoc, /phone view/);
    assert.equal(result.bytes, Buffer.byteLength(result.srcdoc, "utf8"));
  });

  it("injects the locale-picked dict when the view declares i18n", async () => {
    const build = createBuildRemoteView(buildDeps());
    const result = await build(collection([{ ...mobileView, file: "views/phone.html", i18n: "views/phone.i18n.json" }]), "phone", "ja");
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.match(result.srcdoc, /"locale":"ja"/);
    assert.match(result.srcdoc, /こんにちは/);
  });

  it("refuses an unknown view, a desktop view, and a missing file", async () => {
    const build = createBuildRemoteView(buildDeps({ readCustomViewHtml: (async () => null) as unknown as BuildRemoteViewDeps["readCustomViewHtml"] }));
    const desktop = { id: "year", label: "Year", file: "views/year.html" };
    assert.deepEqual(await build(collection([desktop]), "ghost", "en"), { kind: "view-not-found", viewId: "ghost" });
    assert.deepEqual(await build(collection([desktop]), "year", "en"), { kind: "not-mobile", viewId: "year" });
    assert.deepEqual(await build(collection([{ ...mobileView, file: "views/phone.html" }]), "phone", "en"), {
      kind: "file-missing",
      file: "views/phone.html",
    });
  });

  it("rejects a srcdoc over the command-channel budget", async () => {
    const huge = `<html><head></head><body>${"x".repeat(REMOTE_VIEW_MAX_BYTES)}</body></html>`;
    const build = createBuildRemoteView(buildDeps({ readCustomViewHtml: (async () => huge) as unknown as BuildRemoteViewDeps["readCustomViewHtml"] }));
    const result = await build(collection([{ ...mobileView, file: "views/phone.html" }]), "phone", "en");
    assert.equal(result.kind, "too-large");
  });

  it("maps every failure kind to an actionable message", () => {
    assert.match(remoteViewFailureMessage({ kind: "view-not-found", viewId: "v" }, "plan"), /'v' not found on collection 'plan'/);
    assert.match(remoteViewFailureMessage({ kind: "not-mobile", viewId: "v" }, "plan"), /target: "mobile"/);
    assert.match(remoteViewFailureMessage({ kind: "file-missing", file: "views/v.html" }, "plan"), /data\/skills\/plan\/views\/v\.html/);
    assert.match(remoteViewFailureMessage({ kind: "too-large", bytes: 999999 }, "plan"), /999999 bytes/);
  });
});

describe("createGetRemoteView", () => {
  const deps = (overrides: Partial<GetRemoteViewDeps> = {}): GetRemoteViewDeps => ({
    loadCollection: (async (slug: string) =>
      slug === "missing" ? null : collection([{ ...mobileView, file: "views/phone.html" }])) as unknown as GetRemoteViewDeps["loadCollection"],
    buildRemoteView: (async () => ({ kind: "ok", view: mobileView, srcdoc: "<html/>", bytes: 7 })) as unknown as GetRemoteViewDeps["buildRemoteView"],
    ...overrides,
  });

  it("returns { view, srcdoc, bytes } for a mobile view", async () => {
    const handler = createGetRemoteView(deps());
    assert.deepEqual(await handler({ slug: "plan", viewId: "phone" }), { view: mobileView, srcdoc: "<html/>", bytes: 7 });
  });

  it("throws when the collection is not found", async () => {
    const handler = createGetRemoteView(deps());
    await assert.rejects(async () => {
      await handler({ slug: "missing", viewId: "phone" });
    }, /collection 'missing' not found/);
  });

  it("throws the shared failure message on a non-ok build", async () => {
    const handler = createGetRemoteView(
      deps({ buildRemoteView: (async () => ({ kind: "not-mobile", viewId: "year" })) as unknown as GetRemoteViewDeps["buildRemoteView"] }),
    );
    await assert.rejects(async () => {
      await handler({ slug: "plan", viewId: "year" });
    }, /not a mobile view/);
  });

  it("is registered in the runner's method table", () => {
    assert.equal(typeof handlers.getRemoteView, "function");
  });
});
