// Unit tests for the phase-5 remote view item pages: the shared
// createRemoteViewItems builder (engine + thumbnail resolver stubbed) and the
// getRemoteViewItems command handler over it. See plans/done/feat-remote-view-images.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { REMOTE_VIEW_ITEMS_MAX_BYTES } from "@mulmoclaude/core/remote-view";
import { createRemoteViewItems, remoteViewItemsFailureMessage, type RemoteViewItemsDeps } from "../../server/workspace/collections/remoteView.js";
import { createGetRemoteViewItems, type GetRemoteViewItemsDeps } from "../../server/remoteHost/handlers/getRemoteViewItems.js";
import { handlers } from "../../server/remoteHost/handlers/index.js";
import type { LoadedCollection } from "../../server/workspace/collections/index.js";

// A collection with an image-type `photo` field and a plain `note` field, so the
// builder can prove it inlines only declared image-type fields.
const collection = (view: Record<string, unknown>): LoadedCollection =>
  ({
    slug: "plan",
    source: "project",
    skillDir: "/s/plan",
    dataDir: "/d/plan",
    schema: {
      primaryKey: "id",
      fields: { id: { type: "string" }, title: { type: "string" }, photo: { type: "image" }, note: { type: "string" } },
      views: [view],
    },
  }) as unknown as LoadedCollection;

const RECORDS = [
  { id: "a", title: "A", photo: "images/a.png", note: "n1" },
  { id: "b", title: "B", photo: "images/b.png", note: "n2" },
];

const deps = (overrides: Partial<RemoteViewItemsDeps> = {}): RemoteViewItemsDeps => ({
  listRecords: (async () => RECORDS) as unknown as RemoteViewItemsDeps["listRecords"],
  // Identity stub: these fixtures have no computed fields, so the real resolver
  // (enrichItems) returns them unchanged — the builder just threads records through it.
  enrichItems: (async (_collection: unknown, items: unknown[]) => items) as unknown as RemoteViewItemsDeps["enrichItems"],
  // Deterministic stub: a short data URL derived from the path (no native binary).
  resolveThumbnail: (async (relPath: string) => `data:image/jpeg;base64,${Buffer.from(relPath).toString("base64")}`) as RemoteViewItemsDeps["resolveThumbnail"],
  ...overrides,
});

const view = (extra: Record<string, unknown> = {}) => ({ id: "gallery", label: "Gallery", target: "mobile", file: "views/gallery.html", ...extra });

describe("createRemoteViewItems", () => {
  it("refuses an unknown view and a desktop view", async () => {
    const build = createRemoteViewItems(deps());
    assert.deepEqual((await build(collection(view()), "ghost", { offset: 0, limit: 50 })).kind, "view-not-found");
    const desktop = { id: "year", label: "Year", file: "views/year.html" };
    assert.deepEqual((await build(collection(desktop), "year", { offset: 0, limit: 50 })).kind, "not-mobile");
  });

  it("returns a projected page with no inlining when no imageFields declared", async () => {
    const build = createRemoteViewItems(deps());
    const result = await build(collection(view()), "gallery", { offset: 0, limit: 50, fields: ["title"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 0);
    assert.deepEqual(result.page.items[0], { id: "a", title: "A" }); // projected, photo dropped
  });

  it("inlines a declared image field that survives the projection", async () => {
    const build = createRemoteViewItems(deps());
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["title", "photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 2);
    assert.equal(result.omitted, 0);
    assert.match(String(result.page.items[0].photo), /^data:image\/jpeg;base64,/);
  });

  it("does not inline a declared field the projection dropped", async () => {
    const build = createRemoteViewItems(deps());
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["title"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 0);
    assert.equal(result.page.items[0].photo, undefined); // dropped by projection, nothing to inline
  });

  it("ignores a declared field that is not image-type", async () => {
    const build = createRemoteViewItems(deps());
    // `note` is a plain string field — declaring it must not inline it.
    const result = await build(collection(view({ imageFields: ["note"] })), "gallery", { offset: 0, limit: 50, fields: ["title", "note", "photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 0);
    assert.equal(result.page.items[0].note, "n1"); // untouched
    assert.equal(result.page.items[0].photo, "images/a.png"); // photo not declared → left as path
  });

  it("stops inlining once the page byte budget is exceeded, leaving the rest as paths", async () => {
    // Each thumbnail is half the budget, so the first fits and the second overflows.
    const big = `data:image/jpeg;base64,${"x".repeat(Math.floor(REMOTE_VIEW_ITEMS_MAX_BYTES / 2))}`;
    const build = createRemoteViewItems(deps({ resolveThumbnail: (async () => big) as RemoteViewItemsDeps["resolveThumbnail"] }));
    const result = await build(collection(view({ imageFields: ["photo"] })), "gallery", { offset: 0, limit: 50, fields: ["photo"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.equal(result.inlined, 1);
    assert.equal(result.omitted, 1);
    assert.equal(result.page.items[0].photo, big); // inlined
    assert.equal(result.page.items[1].photo, "images/b.png"); // left as path (over budget)
  });

  it("serves host-resolved computed fields (ref-crossing derived, etc.) the resolver produced", async () => {
    // Prove the builder hydrates through enrichItems, not a record-local evaluator:
    // a derived `value` that only the full resolver could compute (e.g. shares *
    // ticker.price) must reach the projected page unchanged.
    const enriched = RECORDS.map((record) => ({ ...record, value: record.id === "a" ? 100 : 250 }));
    const build = createRemoteViewItems(deps({ enrichItems: (async () => enriched) as unknown as RemoteViewItemsDeps["enrichItems"] }));
    const result = await build(collection(view()), "gallery", { offset: 0, limit: 50, fields: ["title", "value"] });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok") return;
    assert.deepEqual(result.page.items[0], { id: "a", title: "A", value: 100 });
    assert.deepEqual(result.page.items[1], { id: "b", title: "B", value: 250 });
  });

  it("rejects a page whose base JSON already exceeds the doc budget", async () => {
    // An embed column can attach a whole record per row; if the projected base
    // page alone overflows the budget, fail with an actionable error rather than
    // letting the oversized doc break the downstream command-channel write.
    const huge = "x".repeat(REMOTE_VIEW_ITEMS_MAX_BYTES);
    const build = createRemoteViewItems(deps({ enrichItems: (async () => [{ id: "a", blob: huge }]) as unknown as RemoteViewItemsDeps["enrichItems"] }));
    const result = await build(collection(view()), "gallery", { offset: 0, limit: 50, fields: ["blob"] });
    assert.equal(result.kind, "too-large");
    if (result.kind !== "too-large") return;
    assert.ok(result.bytes > REMOTE_VIEW_ITEMS_MAX_BYTES);
  });

  it("maps failure kinds to actionable messages", () => {
    assert.match(remoteViewItemsFailureMessage({ kind: "view-not-found", viewId: "v" }, "plan"), /'v' not found on collection 'plan'/);
    assert.match(remoteViewItemsFailureMessage({ kind: "not-mobile", viewId: "v" }, "plan"), /target: "mobile"/);
    assert.match(remoteViewItemsFailureMessage({ kind: "too-large", bytes: 1_000_000 }, "plan"), /over the 900000-byte command-channel budget/);
  });
});

describe("createGetRemoteViewItems", () => {
  const handlerDeps = (overrides: Partial<GetRemoteViewItemsDeps> = {}): GetRemoteViewItemsDeps => ({
    loadCollection: (async (slug: string) =>
      slug === "missing" ? null : collection(view({ imageFields: ["photo"] }))) as unknown as GetRemoteViewItemsDeps["loadCollection"],
    remoteViewItems: (async () => ({
      kind: "ok",
      page: { items: [], total: 0, offset: 0, limit: 50 },
      inlined: 3,
      omitted: 1,
    })) as unknown as GetRemoteViewItemsDeps["remoteViewItems"],
    ...overrides,
  });

  it("returns { page, inlined, omitted } for a mobile view", async () => {
    const handler = createGetRemoteViewItems(handlerDeps());
    assert.deepEqual(await handler({ slug: "plan", viewId: "gallery" }), { page: { items: [], total: 0, offset: 0, limit: 50 }, inlined: 3, omitted: 1 });
  });

  it("throws when the collection is not found", async () => {
    const handler = createGetRemoteViewItems(handlerDeps());
    await assert.rejects(async () => handler({ slug: "missing", viewId: "gallery" }), /collection 'missing' not found/);
  });

  it("throws the shared failure message on a non-ok build", async () => {
    const handler = createGetRemoteViewItems(
      handlerDeps({ remoteViewItems: (async () => ({ kind: "not-mobile", viewId: "year" })) as unknown as GetRemoteViewItemsDeps["remoteViewItems"] }),
    );
    await assert.rejects(async () => handler({ slug: "plan", viewId: "year" }), /not a mobile view/);
  });

  it("is registered in the runner's method table", () => {
    assert.equal(typeof handlers.getRemoteViewItems, "function");
  });
});
