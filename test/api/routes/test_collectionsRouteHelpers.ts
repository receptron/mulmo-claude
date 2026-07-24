// The shared refusal helpers behind the collection routes: the
// store-failure → HTTP mapper (item create / update / delete) and the
// find-or-404 lookups (custom view, record-level action).
//
// The statuses AND the exact wording are the contract here — the client
// surfaces the message verbatim, and `path-escape` → 403 is a
// workspace-escape REFUSAL, not a validation complaint. Both are pinned
// literally so a "tidy-up" of either shows up as a failing test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";

import { findActionOr404, findViewOr404, sendStoreFailure, type StoreFailure } from "../../../server/api/routes/collections.js";
import type { LoadedCollection } from "../../../server/workspace/collections/index.js";

function fakeRes() {
  let statusCode: number | undefined;
  let body: unknown;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (payload: unknown) => {
      body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, status: () => statusCode, error: () => (body as { error?: string } | undefined)?.error };
}

function sent(failure: StoreFailure, onConflict: "duplicate" | "unreachable") {
  const { res, status, error } = fakeRes();
  sendStoreFailure(res, failure, { slug: "invoices", onConflict });
  return { status: status(), error: error() };
}

describe("sendStoreFailure", () => {
  it("400s an invalid id, echoing the rejected id", () => {
    assert.deepEqual(sent({ kind: "invalid-id", itemId: "../etc/passwd" }, "duplicate"), {
      status: 400,
      error: "invalid item id: ../etc/passwd",
    });
  });

  // A data dir that escapes the workspace is a refusal, not bad input:
  // 403 regardless of which handler asked, and the message names the
  // collection (not the item).
  it("403s a path escape for every caller, naming the collection", () => {
    const expected = { status: 403, error: "data directory for collection 'invoices' escapes the workspace" };
    assert.deepEqual(sent({ kind: "path-escape", itemId: "inv-1" }, "duplicate"), expected);
    assert.deepEqual(sent({ kind: "path-escape", itemId: "inv-1" }, "unreachable"), expected);
  });

  it("404s a missing record (delete)", () => {
    assert.deepEqual(sent({ kind: "not-found", itemId: "inv-9" }, "unreachable"), {
      status: 404,
      error: "item 'inv-9' not found",
    });
  });

  // Create writes with `refuseOverwrite`, so a duplicate id is a real 409.
  it("409s a conflict when the caller refuses to overwrite", () => {
    assert.deepEqual(sent({ kind: "conflict", itemId: "inv-1" }, "duplicate"), {
      status: 409,
      error: "item 'inv-1' already exists",
    });
  });

  // Update leaves `refuseOverwrite` false and delete cannot report a
  // conflict at all, so reaching this branch means the store changed
  // underneath the routes — say so with a 500 rather than inventing an
  // "already exists" the client would show to a user.
  it("500s a conflict the caller cannot legitimately reach", () => {
    assert.deepEqual(sent({ kind: "conflict", itemId: "inv-1" }, "unreachable"), {
      status: 500,
      error: "unexpected conflict on update",
    });
  });

  // The union is exhaustive today; a new store backend adding a kind must
  // still get an answer — an unanswered request hangs until the client
  // times out, which is the worst of the available failures.
  it("still answers a kind outside the declared union", () => {
    const unknownKind = { kind: "quota-exceeded", itemId: "inv-1" } as unknown as StoreFailure;
    assert.equal(sent(unknownKind, "duplicate").status, 409);
    assert.equal(sent(unknownKind, "unreachable").status, 500);
  });
});

function collectionWith(schema: Record<string, unknown>): LoadedCollection {
  return { slug: "invoices", source: "project", schema, dataDir: "/d/invoices", skillDir: "/s/invoices" } as unknown as LoadedCollection;
}

describe("findViewOr404", () => {
  const collection = collectionWith({
    views: [
      { id: "board", file: "views/board.html" },
      { id: "grid", file: "views/grid.html" },
    ],
  });

  it("returns the named view and sends nothing", () => {
    const { res, status } = fakeRes();
    assert.deepEqual(findViewOr404(collection, "grid", res), { id: "grid", file: "views/grid.html" });
    assert.equal(status(), undefined);
  });

  it("404s an unknown view id, naming both the view and the collection", () => {
    const { res, status, error } = fakeRes();
    assert.equal(findViewOr404(collection, "ghost", res), null);
    assert.equal(status(), 404);
    assert.equal(error(), "custom view 'ghost' not found on collection 'invoices'");
  });

  // An absent `?id=` reaches here as "" — the same 404, not a crash and
  // not the first view.
  it("404s a blank id and a collection that declares no views", () => {
    assert.equal(findViewOr404(collection, "", fakeRes().res), null);
    assert.equal(findViewOr404(collectionWith({}), "board", fakeRes().res), null);
  });
});

describe("findActionOr404", () => {
  const collection = collectionWith({
    actions: [
      { id: "pay", kind: "mutate" },
      { id: "draft", kind: "chat" },
    ],
  });

  it("returns the named action and sends nothing", () => {
    const { res, status } = fakeRes();
    assert.deepEqual(findActionOr404(collection, "pay", res), { id: "pay", kind: "mutate" });
    assert.equal(status(), undefined);
  });

  it("404s an unknown action id, naming both the action and the collection", () => {
    const { res, status, error } = fakeRes();
    assert.equal(findActionOr404(collection, "delete-everything", res), null);
    assert.equal(status(), 404);
    assert.equal(error(), "action 'delete-everything' not found on collection 'invoices'");
  });

  // `actions` is optional in the schema — a collection without any must
  // 404 rather than throw on the undefined array.
  it("404s a blank id and a collection that declares no actions", () => {
    assert.equal(findActionOr404(collection, "", fakeRes().res), null);
    assert.equal(findActionOr404(collectionWith({}), "pay", fakeRes().res), null);
  });
});
