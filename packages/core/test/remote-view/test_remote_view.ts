// Unit tests for the remote custom-view contract (@mulmoclaude/core/remote-view):
// CSP policy, srcdoc wrapping/escaping, pagination clamps + projection, and the
// parent-side postMessage handler. Pure logic — no DOM, no engine.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_IMAGE_MAX_EDGE,
  REMOTE_VIEW_MESSAGES,
  REMOTE_VIEW_PROTOCOL,
  buildRemoteViewCsp,
  buildRemoteViewSrcdoc,
  clampImageMaxEdge,
  clampLimit,
  clampOffset,
  readIdParam,
  handleRemoteViewMessage,
  normalizeFields,
  normalizeMutate,
  pageFromItems,
  projectItems,
  type RemoteViewMutateRequest,
} from "../../src/remote-view/index.js";

describe("buildRemoteViewCsp", () => {
  it("locks connect-src to 'none' (data comes over postMessage, never fetch)", () => {
    const csp = buildRemoteViewCsp();
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /default-src 'none'/);
  });

  it("keeps the curated CDN allowlist for scripts/styles and https images/media", () => {
    const csp = buildRemoteViewCsp();
    assert.match(csp, /script-src 'unsafe-inline' [^;]*cdn\.jsdelivr\.net/);
    assert.match(csp, /img-src [^;]*https:/);
    assert.match(csp, /media-src https: data: blob:/);
  });
});

describe("buildRemoteViewSrcdoc", () => {
  it("injects the CSP meta + boot at the start of <head>, with no token/dataUrl", () => {
    const srcdoc = buildRemoteViewSrcdoc("<html><head><title>v</title></head><body></body></html>", { slug: "plan" });
    assert.match(srcdoc, /<head><meta http-equiv="Content-Security-Policy"/);
    assert.match(srcdoc, /window\.__MC_VIEW=\{"slug":"plan"/);
    assert.match(srcdoc, new RegExp(`"protocol":${REMOTE_VIEW_PROTOCOL}`));
    assert.doesNotMatch(srcdoc, /token|dataUrl/);
    // The boot lands BEFORE the view's own head content.
    assert.ok(srcdoc.indexOf("__MC_VIEW") < srcdoc.indexOf("<title>"));
  });

  it("wraps a headless fragment into a full document", () => {
    const srcdoc = buildRemoteViewSrcdoc("<p>hi</p>", { slug: "x" });
    assert.match(srcdoc, /^<!DOCTYPE html><html><head>/);
    assert.match(srcdoc, /<body><p>hi<\/p><\/body>/);
  });

  it("carries protocol 2 and defaults writable:false; installs mutators only when writable", () => {
    const readOnlyBoot = buildRemoteViewSrcdoc("<html><head></head></html>", { slug: "x" });
    assert.match(readOnlyBoot, new RegExp(`"protocol":${REMOTE_VIEW_PROTOCOL}`));
    assert.equal(REMOTE_VIEW_PROTOCOL, 2);
    assert.match(readOnlyBoot, /"writable":false/);
    // Read-only boot: the mutators reject rather than post.
    assert.match(readOnlyBoot, /this view is read-only/);

    const writableBoot = buildRemoteViewSrcdoc("<html><head></head></html>", { slug: "x", writable: true });
    assert.match(writableBoot, /"writable":true/);
    // Writable boot still ships the read-only fallback string in the (untaken)
    // else branch — assert the mutate wiring is present instead.
    assert.match(writableBoot, new RegExp(REMOTE_VIEW_MESSAGES.mutate));
  });

  it("escapes `<` in the boot JSON so a hostile dict value can't break out", () => {
    const srcdoc = buildRemoteViewSrcdoc("<html><head></head></html>", {
      slug: "x",
      locale: "en",
      dict: { evil: "</script><script>alert(1)</script>" },
    });
    assert.doesNotMatch(srcdoc, /"evil":"<\/script>/);
    assert.match(srcdoc, /\\u003c\/script/);
  });
});

describe("clamps + projection", () => {
  it("clampOffset / clampLimit mirror the phase-2 record-handler semantics", () => {
    assert.equal(clampOffset(-5), 0);
    assert.equal(clampOffset("3"), 3);
    assert.equal(clampOffset(undefined), 0);
    assert.equal(clampLimit(100000), 200);
    assert.equal(clampLimit(0), 50);
    assert.equal(clampLimit("7"), 7);
  });

  // Params arrive as untyped JSON over the command channel, so a caller can send
  // anything. `String(...)` turned an object into "[object Object]", which then
  // travelled on as if it were the requested slug — surfacing as
  // `collection '[object Object]' not found` instead of a bad request.
  it("readIdParam takes only real strings", () => {
    assert.equal(readIdParam("notes"), "notes");
    assert.equal(readIdParam(""), "");
    assert.equal(readIdParam(undefined), "");
    assert.equal(readIdParam(null), "");
    assert.equal(readIdParam({ slug: "notes" }), "");
    assert.equal(readIdParam(["notes"]), "");
    // Unlike clampOffset("3") === 3, an id is NOT coerced from a number — a
    // numeric slug would address a different collection than the caller meant.
    assert.equal(readIdParam(42), "");
    assert.equal(String({ slug: "notes" }), "[object Object]"); // what it replaced
  });

  it("normalizeFields keeps only non-empty strings", () => {
    assert.deepEqual(normalizeFields(["title", " ", 3, "start"]), ["title", "start"]);
    assert.equal(normalizeFields([]), undefined);
    assert.equal(normalizeFields("title"), undefined);
  });

  it("clampImageMaxEdge defaults and bounds the thumbnail edge to [64, 1024]", () => {
    assert.equal(clampImageMaxEdge(undefined), DEFAULT_IMAGE_MAX_EDGE);
    assert.equal(clampImageMaxEdge(0), DEFAULT_IMAGE_MAX_EDGE);
    assert.equal(clampImageMaxEdge(-10), DEFAULT_IMAGE_MAX_EDGE);
    assert.equal(clampImageMaxEdge(16), 64);
    assert.equal(clampImageMaxEdge(9999), 1024);
    assert.equal(clampImageMaxEdge("384"), 384);
  });

  it("projectItems keeps the primary key and only the listed fields", () => {
    const projected = projectItems([{ id: "a", title: "T", secret: "s" }], ["title"], "id");
    assert.deepEqual(projected, [{ id: "a", title: "T" }]);
  });

  it("pageFromItems slices and reports the full total", () => {
    const items = Array.from({ length: 5 }, (_unused, index) => ({ id: `r${index}`, title: `t${index}` }));
    const page = pageFromItems(items, { offset: 1, limit: 2, fields: ["title"] }, "id");
    assert.deepEqual(page, {
      items: [
        { id: "r1", title: "t1" },
        { id: "r2", title: "t2" },
      ],
      total: 5,
      offset: 1,
      limit: 2,
    });
  });
});

describe("handleRemoteViewMessage", () => {
  const getItemsMsg = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: REMOTE_VIEW_MESSAGES.getItems,
    slug: "plan",
    requestId: "q1",
    ...extra,
  });

  it("answers a get-items request with a normalized page", async () => {
    const replies: Record<string, unknown>[] = [];
    const handled = await handleRemoteViewMessage(
      getItemsMsg({ offset: -3, limit: 100000, fields: ["title", 9] }),
      { slug: "plan", getPage: (request) => pageFromItems([{ id: "a", title: "T", x: 1 }], request, "id") },
      (message) => replies.push(message),
    );
    assert.equal(handled, true);
    assert.deepEqual(replies, [
      { type: REMOTE_VIEW_MESSAGES.items, requestId: "q1", ok: true, page: { items: [{ id: "a", title: "T" }], total: 1, offset: 0, limit: 200 } },
    ]);
  });

  it("replies ok:false with the error message when getPage throws", async () => {
    const replies: Record<string, unknown>[] = [];
    await handleRemoteViewMessage(
      getItemsMsg(),
      {
        slug: "plan",
        getPage: () => {
          throw new Error("channel down");
        },
      },
      (message) => replies.push(message),
    );
    assert.deepEqual(replies, [{ type: REMOTE_VIEW_MESSAGES.items, requestId: "q1", ok: false, error: "channel down" }]);
  });

  it("ignores foreign slugs, unknown types, and a missing requestId", async () => {
    const replies: unknown[] = [];
    const handlers = { slug: "plan", getPage: () => pageFromItems([], { offset: 0, limit: 50 }, "id") };
    const reply = (message: Record<string, unknown>): void => {
      replies.push(message);
    };
    assert.equal(await handleRemoteViewMessage(getItemsMsg({ slug: "other" }), handlers, reply), false);
    assert.equal(await handleRemoteViewMessage({ type: "mc-collection-changed", slug: "plan" }, handlers, reply), false);
    assert.equal(await handleRemoteViewMessage(getItemsMsg({ requestId: 7 }), handlers, reply), false);
    assert.equal(await handleRemoteViewMessage("nope", handlers, reply), false);
    assert.equal(replies.length, 0);
  });

  it("relays startChat (trimmed prompt, string-only role), swallowing empties", async () => {
    const chats: { prompt: string; role?: string }[] = [];
    const handlers = {
      slug: "plan",
      getPage: () => pageFromItems([], { offset: 0, limit: 50 }, "id"),
      onStartChat: (prompt: string, role?: string) => {
        chats.push({ prompt, role });
      },
    };
    const reply = (): void => {};
    assert.equal(await handleRemoteViewMessage({ type: REMOTE_VIEW_MESSAGES.startChat, slug: "plan", prompt: "  do it  ", role: 3 }, handlers, reply), true);
    assert.equal(await handleRemoteViewMessage({ type: REMOTE_VIEW_MESSAGES.startChat, slug: "plan", prompt: "   " }, handlers, reply), true);
    assert.deepEqual(chats, [{ prompt: "do it", role: undefined }]);
  });
});

describe("normalizeMutate", () => {
  it("accepts update (object patch) and delete, coercing id to string", () => {
    assert.deepEqual(normalizeMutate({ op: "update", id: 7, patch: { done: true } }), { op: "update", id: "7", patch: { done: true } });
    assert.deepEqual(normalizeMutate({ op: "delete", id: "a" }), { op: "delete", id: "a" });
  });

  it("rejects unknown op, missing id, and a non-object update patch", () => {
    assert.equal(normalizeMutate({ op: "wipe", id: "a" }), null);
    assert.equal(normalizeMutate({ op: "delete" }), null);
    assert.equal(normalizeMutate({ op: "update", id: "a", patch: [1, 2] }), null);
    assert.equal(normalizeMutate({ op: "update", id: "a", patch: "x" }), null);
  });
});

describe("handleRemoteViewMessage — mutate", () => {
  const mutateMsg = (extra: Record<string, unknown>): Record<string, unknown> => ({
    type: REMOTE_VIEW_MESSAGES.mutate,
    slug: "plan",
    requestId: "m1",
    ...extra,
  });

  it("applies an update/delete via onMutate and replies with the result", async () => {
    const seen: RemoteViewMutateRequest[] = [];
    const replies: Record<string, unknown>[] = [];
    const handlers = {
      slug: "plan",
      getPage: () => pageFromItems([], { offset: 0, limit: 50 }, "id"),
      onMutate: (request: RemoteViewMutateRequest) => {
        seen.push(request);
        return request.op === "delete" ? { id: request.id } : { item: { id: request.id, done: true } };
      },
    };
    await handleRemoteViewMessage(mutateMsg({ op: "update", id: "a", patch: { done: true } }), handlers, (msg) => replies.push(msg));
    await handleRemoteViewMessage(mutateMsg({ op: "delete", id: "a", requestId: "m2" }), handlers, (msg) => replies.push(msg));
    assert.deepEqual(seen, [
      { op: "update", id: "a", patch: { done: true } },
      { op: "delete", id: "a" },
    ]);
    assert.deepEqual(replies, [
      { type: REMOTE_VIEW_MESSAGES.mutateResult, requestId: "m1", ok: true, result: { item: { id: "a", done: true } } },
      { type: REMOTE_VIEW_MESSAGES.mutateResult, requestId: "m2", ok: true, result: { id: "a" } },
    ]);
  });

  it("replies read-only when the parent supplies no onMutate", async () => {
    const replies: Record<string, unknown>[] = [];
    const handled = await handleRemoteViewMessage(
      mutateMsg({ op: "update", id: "a", patch: { done: true } }),
      { slug: "plan", getPage: () => pageFromItems([], { offset: 0, limit: 50 }, "id") },
      (msg) => replies.push(msg),
    );
    assert.equal(handled, true);
    assert.deepEqual(replies, [{ type: REMOTE_VIEW_MESSAGES.mutateResult, requestId: "m1", ok: false, error: "this view is read-only" }]);
  });

  it("replies with the error message when onMutate throws, and rejects a malformed request", async () => {
    const replies: Record<string, unknown>[] = [];
    const handlers = {
      slug: "plan",
      getPage: () => pageFromItems([], { offset: 0, limit: 50 }, "id"),
      onMutate: () => {
        throw new Error("field 'x' is not editable");
      },
    };
    await handleRemoteViewMessage(mutateMsg({ op: "update", id: "a", patch: { x: 1 } }), handlers, (msg) => replies.push(msg));
    await handleRemoteViewMessage(mutateMsg({ op: "wipe", id: "a", requestId: "m3" }), handlers, (msg) => replies.push(msg));
    assert.deepEqual(replies, [
      { type: REMOTE_VIEW_MESSAGES.mutateResult, requestId: "m1", ok: false, error: "field 'x' is not editable" },
      { type: REMOTE_VIEW_MESSAGES.mutateResult, requestId: "m3", ok: false, error: "invalid mutate request" },
    ]);
  });
});
