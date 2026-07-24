// Unit tests for the phase-4 writable remote-view surface: the shared
// createMutateRemoteView builder (io stubbed) and the mutateRemoteViewItem
// command handler over it. See plans/done/feat-remote-writable-view.md.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { REMOTE_VIEW_ITEMS_MAX_BYTES } from "@mulmoclaude/core/remote-view";
import { createMutateRemoteView, mutateRemoteViewFailureMessage, type MutateRemoteViewDeps } from "../../server/workspace/collections/remoteView.js";
import { createMutateRemoteViewHandler, type MutateRemoteViewHandlerDeps } from "../../server/remoteHost/handlers/mutateRemoteView.js";
import { handlers } from "../../server/remoteHost/handlers/index.js";
import type { CollectionStore, LoadedCollection } from "../../server/workspace/collections/index.js";

const collection = (views: unknown[]): LoadedCollection =>
  ({
    slug: "todos",
    source: "project",
    skillDir: "/s/todos",
    dataDir: "/d/todos",
    schema: { primaryKey: "id", fields: {}, views },
  }) as unknown as LoadedCollection;

// A view that may toggle `done` and delete records.
const writableView = { id: "phone", label: "Todos", target: "mobile", file: "views/phone.html", editableFields: ["done"], allowDelete: true };

const record = { id: "t1", title: "buy milk", done: false };

// A writable in-memory store stub — the mutate flow reads/writes/deletes
// through the injected storeFor, so tests override store methods, not io fns.
const fakeStore = (storeOverrides: Partial<CollectionStore> = {}): CollectionStore =>
  ({
    capabilities: { writable: true, nativeQuery: false, nativePaging: false },
    list: async () => [],
    page: async () => ({ items: [], total: 0, truncated: false }),
    read: async () => ({ ...record }),
    write: async (itemId: string, item: unknown) => ({ kind: "ok", itemId, item }),
    delete: async (itemId: string) => ({ kind: "ok", itemId }),
    ...storeOverrides,
  }) as CollectionStore;

const deps = (storeOverrides: Partial<CollectionStore> = {}, overrides: Partial<MutateRemoteViewDeps> = {}): MutateRemoteViewDeps => ({
  storeFor: () => fakeStore(storeOverrides),
  // Identity stub: fixtures have no computed fields, so the real resolver returns
  // them unchanged — the update path just threads the written record through it.
  enrichItems: (async (_collection: unknown, items: unknown[]) => items) as unknown as MutateRemoteViewDeps["enrichItems"],
  // A declared-image view inlines the returned item's image fields; the default
  // view here declares none, so this is only exercised by the dedicated test below.
  resolveThumbnail: (async (relPath: string) =>
    `data:image/jpeg;base64,${Buffer.from(relPath).toString("base64")}`) as MutateRemoteViewDeps["resolveThumbnail"],
  ...overrides,
});

describe("createMutateRemoteView", () => {
  it("updates a whitelisted field, merging the patch onto the existing record", async () => {
    let written: unknown;
    const mutate = createMutateRemoteView(
      deps({
        write: (async (itemId: string, item: unknown) => ((written = item), { kind: "ok", itemId, item })) as unknown as CollectionStore["write"],
      }),
    );
    const result = await mutate(collection([writableView]), "phone", { op: "update", id: "t1", patch: { done: true } });
    assert.deepEqual(result, { kind: "ok", op: "update", item: { id: "t1", title: "buy milk", done: true } });
    // The patch merges — untouched fields survive, id is pinned to the URL id.
    assert.deepEqual(written, { id: "t1", title: "buy milk", done: true });
  });

  it("inlines the view's declared image fields on the returned update item", async () => {
    // Regression: the returned item must be shaped like a getItems item (image
    // fields as data: URLs), else a view that merges the result clobbers its
    // inlined thumbnail with a bare path and the image disappears.
    const withImage = collection([{ ...writableView, editableFields: ["rating"], imageFields: ["poster"] }]);
    withImage.schema.fields = { id: { type: "string" }, rating: { type: "string" }, poster: { type: "image" } } as unknown as typeof withImage.schema.fields;
    const mutate = createMutateRemoteView(
      deps({
        read: (async () => ({ id: "t1", rating: "", poster: "images/a.png" })) as unknown as CollectionStore["read"],
      }),
    );
    const result = await mutate(withImage, "phone", { op: "update", id: "t1", patch: { rating: "★★★" } });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok" || result.op !== "update") return;
    assert.equal(result.item.rating, "★★★");
    assert.match(String(result.item.poster), /^data:image\/jpeg;base64,/); // inlined, not the path
  });

  it("leaves the image as a path when the thumbnail would exceed the remaining budget", async () => {
    // The base item fits, but the thumbnail is bigger than the room left under the
    // doc budget — it must stay a path, not overflow the doc. (A base item that is
    // itself over budget is a `too-large` failure, covered separately.)
    const withImage = collection([{ ...writableView, editableFields: ["rating"], imageFields: ["poster"] }]);
    withImage.schema.fields = { id: { type: "string" }, rating: { type: "string" }, poster: { type: "image" } } as unknown as typeof withImage.schema.fields;
    const big = `data:image/jpeg;base64,${"x".repeat(REMOTE_VIEW_ITEMS_MAX_BYTES)}`;
    const mutate = createMutateRemoteView(
      deps(
        { read: (async () => ({ id: "t1", rating: "", poster: "images/a.png" })) as unknown as CollectionStore["read"] },
        { resolveThumbnail: (async () => big) as MutateRemoteViewDeps["resolveThumbnail"] },
      ),
    );
    const result = await mutate(withImage, "phone", { op: "update", id: "t1", patch: { rating: "★" } });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok" || result.op !== "update") return;
    assert.equal(result.item.poster, "images/a.png"); // left as path — thumbnail over the remaining budget
  });

  it("returns the update item in the enriched getItems shape (computed fields resolved)", async () => {
    // Regression for the getItems/updateItem shape parity: a view that merges the
    // update result must keep its host-computed columns (e.g. a ref-crossing
    // `value = shares * ticker.price`), not drop them until the next refetch.
    const mutate = createMutateRemoteView(
      deps(
        { read: (async () => ({ id: "t1", shares: 2 })) as unknown as CollectionStore["read"] },
        {
          enrichItems: (async (_collection: unknown, items: Record<string, unknown>[]) =>
            items.map((entry) => ({ ...entry, value: Number(entry.shares) * 50 }))) as unknown as MutateRemoteViewDeps["enrichItems"],
        },
      ),
    );
    const editable = collection([{ ...writableView, editableFields: ["shares"] }]);
    const result = await mutate(editable, "phone", { op: "update", id: "t1", patch: { shares: 3 } });
    assert.equal(result.kind, "ok");
    if (result.kind !== "ok" || result.op !== "update") return;
    assert.equal(result.item.value, 150); // 3 * 50 — resolved host-side, present on the returned item
  });

  it("returns too-large when enrichment inflates the response past the doc budget", async () => {
    // The write persists, but an embed/computed payload can push the enriched item
    // over the command-doc cap — fail predictably here, not downstream on write.
    const huge = "x".repeat(REMOTE_VIEW_ITEMS_MAX_BYTES);
    const mutate = createMutateRemoteView(
      deps(
        { read: (async () => ({ id: "t1", done: false })) as unknown as CollectionStore["read"] },
        {
          enrichItems: (async (_collection: unknown, items: Record<string, unknown>[]) =>
            items.map((entry) => ({ ...entry, embedded: huge }))) as unknown as MutateRemoteViewDeps["enrichItems"],
        },
      ),
    );
    const result = await mutate(collection([writableView]), "phone", { op: "update", id: "t1", patch: { done: true } });
    assert.equal(result.kind, "too-large");
    if (result.kind !== "too-large") return;
    assert.ok(result.bytes > REMOTE_VIEW_ITEMS_MAX_BYTES);
  });

  it("deletes a record when allowDelete is set", async () => {
    const result = await createMutateRemoteView(deps())(collection([writableView]), "phone", { op: "delete", id: "t1" });
    assert.deepEqual(result, { kind: "ok", op: "delete", id: "t1" });
  });

  it("refuses a patch touching a non-whitelisted field (and the primary key)", async () => {
    const mutate = createMutateRemoteView(deps());
    assert.deepEqual(await mutate(collection([writableView]), "phone", { op: "update", id: "t1", patch: { title: "x" } }), {
      kind: "field-not-editable",
      field: "title",
    });
    assert.deepEqual(await mutate(collection([writableView]), "phone", { op: "update", id: "t1", patch: { id: "hacked" } }), {
      kind: "field-not-editable",
      field: "id",
    });
  });

  it("reports invalid-id for an unsafe id on update (not a masked item-not-found)", async () => {
    // The store's read/write stubs are never reached — the safeRecordId preflight
    // classifies `bad/id` before any IO, matching the delete path's behaviour.
    const result = await createMutateRemoteView(deps())(collection([writableView]), "phone", { op: "update", id: "bad/id", patch: { done: true } });
    assert.deepEqual(result, { kind: "invalid-id", id: "bad/id" });
  });

  it("refuses an empty patch and a missing record", async () => {
    assert.deepEqual(await createMutateRemoteView(deps())(collection([writableView]), "phone", { op: "update", id: "t1", patch: {} }), {
      kind: "invalid-patch",
    });
    const noItem = createMutateRemoteView(deps({ read: (async () => null) as unknown as CollectionStore["read"] }));
    assert.deepEqual(await noItem(collection([writableView]), "phone", { op: "update", id: "ghost", patch: { done: true } }), {
      kind: "item-not-found",
      id: "ghost",
    });
  });

  it("refuses delete when allowDelete is absent, and update when no editableFields", async () => {
    const deleteOnly = { id: "phone", label: "P", target: "mobile", file: "views/phone.html", allowDelete: true };
    const updateOnly = { id: "phone", label: "P", target: "mobile", file: "views/phone.html", editableFields: ["done"] };
    assert.deepEqual(await createMutateRemoteView(deps())(collection([updateOnly]), "phone", { op: "delete", id: "t1" }), { kind: "delete-not-allowed" });
    // A delete-only view exposes no editable field, so any update key is refused.
    assert.deepEqual(await createMutateRemoteView(deps())(collection([deleteOnly]), "phone", { op: "update", id: "t1", patch: { done: true } }), {
      kind: "field-not-editable",
      field: "done",
    });
  });

  it("refuses a read-only mobile view, a desktop view, and an unknown view", async () => {
    const readOnly = { id: "phone", label: "P", target: "mobile", file: "views/phone.html" };
    const desktop = { id: "year", label: "Y", file: "views/year.html", editableFields: ["done"] };
    const mutate = createMutateRemoteView(deps());
    assert.deepEqual(await mutate(collection([readOnly]), "phone", { op: "delete", id: "t1" }), { kind: "not-writable", viewId: "phone" });
    assert.deepEqual(await mutate(collection([desktop]), "year", { op: "delete", id: "t1" }), { kind: "not-mobile", viewId: "year" });
    assert.deepEqual(await mutate(collection([writableView]), "ghost", { op: "delete", id: "t1" }), { kind: "view-not-found", viewId: "ghost" });
  });

  it("maps every failure kind to an actionable message", () => {
    assert.match(mutateRemoteViewFailureMessage({ kind: "view-not-found", viewId: "phone" }, "todos"), /'phone' not found on collection 'todos'/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "not-mobile", viewId: "year" }, "todos"), /target: "mobile"/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "not-writable", viewId: "phone" }, "todos"), /read-only — declare editableFields/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "field-not-editable", field: "title" }, "todos"), /'title' is not editable/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "delete-not-allowed" }, "todos"), /allowDelete: true/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "invalid-patch" }, "todos"), /non-empty object/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "item-not-found", id: "t9" }, "todos"), /'t9' not found/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "invalid-id", id: "bad/id" }, "todos"), /invalid item id: bad\/id/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "path-escape" }, "todos"), /escapes the workspace/);
    assert.match(mutateRemoteViewFailureMessage({ kind: "too-large", bytes: 1_000_000 }, "todos"), /over the 900000-byte command-channel budget/);
  });
});

describe("createMutateRemoteViewHandler", () => {
  const handlerDeps = (overrides: Partial<MutateRemoteViewHandlerDeps> = {}): MutateRemoteViewHandlerDeps => ({
    loadCollection: (async (slug: string) =>
      slug === "missing" ? null : collection([writableView])) as unknown as MutateRemoteViewHandlerDeps["loadCollection"],
    mutateRemoteView: (async () => ({
      kind: "ok",
      op: "update",
      item: { id: "t1", done: true },
    })) as unknown as MutateRemoteViewHandlerDeps["mutateRemoteView"],
    ...overrides,
  });

  it("returns the update result for a valid request", async () => {
    const handler = createMutateRemoteViewHandler(handlerDeps());
    assert.deepEqual(await handler({ slug: "todos", viewId: "phone", op: "update", id: "t1", patch: { done: true } }), {
      op: "update",
      item: { id: "t1", done: true },
    });
  });

  it("returns the delete result shape", async () => {
    const handler = createMutateRemoteViewHandler(
      handlerDeps({ mutateRemoteView: (async () => ({ kind: "ok", op: "delete", id: "t1" })) as unknown as MutateRemoteViewHandlerDeps["mutateRemoteView"] }),
    );
    assert.deepEqual(await handler({ slug: "todos", viewId: "phone", op: "delete", id: "t1" }), { op: "delete", id: "t1" });
  });

  it("throws on a malformed request, an unknown collection, and a non-ok mutate", async () => {
    await assert.rejects(
      async () => createMutateRemoteViewHandler(handlerDeps())({ slug: "todos", viewId: "phone", op: "wipe", id: "t1" }),
      /invalid mutate request/,
    );
    await assert.rejects(
      async () => createMutateRemoteViewHandler(handlerDeps())({ slug: "missing", viewId: "phone", op: "delete", id: "t1" }),
      /collection 'missing' not found/,
    );
    const rejecting = createMutateRemoteViewHandler(
      handlerDeps({ mutateRemoteView: (async () => ({ kind: "delete-not-allowed" })) as unknown as MutateRemoteViewHandlerDeps["mutateRemoteView"] }),
    );
    await assert.rejects(async () => rejecting({ slug: "todos", viewId: "phone", op: "delete", id: "t1" }), /allowDelete: true/);
  });

  it("is registered in the runner's method table", () => {
    assert.equal(typeof handlers.mutateRemoteViewItem, "function");
  });
});
