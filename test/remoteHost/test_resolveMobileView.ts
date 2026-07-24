// Unit tests for the shared remote-view access guard. `resolveMobileView` is the
// single place a remote entry point may resolve a view, so a desktop-only view
// can never be served to a phone — these pin every way that refusal is reached.
// The per-factory "the guard fires through this entry point too" cases live with
// their factories (test_getRemoteView / test_mutateRemoteView / test_remoteViewItems).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveMobileView } from "../../server/workspace/collections/remoteView.js";
import type { LoadedCollection } from "../../server/workspace/collections/index.js";

const collection = (views: unknown[] | undefined): LoadedCollection =>
  ({
    slug: "plan",
    source: "project",
    skillDir: "/s/plan",
    dataDir: "/d/plan",
    schema: { primaryKey: "id", fields: {}, views },
  }) as unknown as LoadedCollection;

const mobileView = { id: "phone", label: "Phone", target: "mobile", file: "views/phone.html" };
const desktopView = { id: "year", label: "Year", target: "desktop", file: "views/year.html" };
// `target` is optional in the schema, so an entry that omits it is a desktop
// view by default — the guard must refuse it, not read it as "unset means allow".
const untargetedView = { id: "year", label: "Year", file: "views/year.html" };

describe("resolveMobileView", () => {
  it("returns the matching mobile view", () => {
    assert.deepEqual(resolveMobileView(collection([desktopView, mobileView]), "phone"), { kind: "ok", view: mobileView });
  });

  it("reports view-not-found when the collection declares no views at all", () => {
    // `schema.views` is optional; the `?? []` fallback is what keeps this a
    // refusal instead of a TypeError on `.find`.
    assert.deepEqual(resolveMobileView(collection(undefined), "phone"), { kind: "view-not-found", viewId: "phone" });
  });

  it("reports view-not-found for an empty views array", () => {
    assert.deepEqual(resolveMobileView(collection([]), "phone"), { kind: "view-not-found", viewId: "phone" });
  });

  it("reports view-not-found when no entry matches the id", () => {
    assert.deepEqual(resolveMobileView(collection([mobileView]), "ghost"), { kind: "view-not-found", viewId: "ghost" });
  });

  it("refuses an explicit desktop target", () => {
    assert.deepEqual(resolveMobileView(collection([desktopView]), "year"), { kind: "not-mobile", viewId: "year" });
  });

  it("refuses an entry with no target declared", () => {
    assert.deepEqual(resolveMobileView(collection([untargetedView]), "year"), { kind: "not-mobile", viewId: "year" });
  });

  it("checks existence before target, so an unknown id on a desktop-only collection is view-not-found", () => {
    assert.deepEqual(resolveMobileView(collection([desktopView]), "phone"), { kind: "view-not-found", viewId: "phone" });
  });

  it("matches by id rather than position, so a later mobile entry still resolves", () => {
    const second = { ...mobileView, id: "phone2" };
    assert.deepEqual(resolveMobileView(collection([desktopView, mobileView, second]), "phone2"), { kind: "ok", view: second });
  });
});
