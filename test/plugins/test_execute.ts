// Tests for the shared plugin `execute()` factories (#2335).
//
// These two factories now own the tool-result assembly convention that
// used to be hand-copied into 9 plugin `index.ts` files: failure returns
// `{ toolName, uuid, message }`, success spreads the server body and
// stamps a fresh `toolName` / `uuid`. A silent regression here (dropping
// the failure branch, reusing one uuid, spreading in the wrong order)
// produces plausible-looking results, so each rule gets its own case.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { ToolResult } from "gui-chat-protocol";
import { makeRouteExecute, makePostExecute } from "../../src/plugins/execute.ts";
import { installHostContext, type EndpointRegistry } from "../../src/plugins/api.ts";
import type { ResolvedRoute } from "../../src/plugins/meta-types.ts";
import { backendReachable, lastBackendError } from "../../src/utils/api.ts";

const TOOL_NAME = "presentThing";

interface ThingData {
  filePath: string;
}

type ThingRoutes = Readonly<Record<"create" | "list", ResolvedRoute>>;
type ImageUrls = Readonly<Record<"edit" | "generate", string>>;

const thingRoutes: ThingRoutes = {
  create: { method: "POST", url: "/api/thing" },
  list: { method: "GET", url: "/api/thing/list" },
};

const imageUrls: ImageUrls = {
  edit: "/api/image/edit",
  generate: "/api/image/generate",
};

const registry: EndpointRegistry = { thing: thingRoutes, image: imageUrls };

function installEndpoints(endpoints: EndpointRegistry = registry): void {
  installHostContext({
    endpoints,
    builtinRoleIds: {},
    pageRoutes: {},
    getAllPluginNames: () => [],
  });
}

// ── fetch double (same shape as test/utils/test_api.ts) ─────────────

type FetchFn = typeof fetch;
type FetchInit = Parameters<FetchFn>[1];

interface MockCall {
  url: string;
  init: FetchInit;
}

let calls: MockCall[] = [];
let nextResponse: () => Response = () => new Response("{}", { status: 200 });
const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function replyWith(status: number, body: unknown): void {
  nextResponse = () => jsonResponse(status, body);
}

function installFetchMock(): void {
  calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(nextResponse());
  };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
  backendReachable.value = true;
  lastBackendError.value = null;
}

describe("makeRouteExecute — success", () => {
  beforeEach(() => {
    installEndpoints();
    installFetchMock();
  });
  afterEach(restoreFetch);

  it("spreads the server body and attaches toolName + uuid", async () => {
    replyWith(200, { message: "Created thing", title: "Thing", data: { filePath: "artifacts/thing.json" } });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    const result = await execute({}, { name: "thing" });

    assert.equal(result.message, "Created thing");
    assert.equal(result.title, "Thing");
    assert.deepEqual(result.data, { filePath: "artifacts/thing.json" });
    assert.equal(result.toolName, TOOL_NAME);
    assert.match(result.uuid ?? "", /^[0-9a-f-]{36}$/);
  });

  it("sends the route's method, url, and the args as a JSON body", async () => {
    replyWith(200, { message: "ok" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    await execute({}, { name: "thing", count: 2 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/thing");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.body, JSON.stringify({ name: "thing", count: 2 }));
  });

  it("uses the route key it was given, not the first route in the group", async () => {
    replyWith(200, { message: "ok" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "list", TOOL_NAME);

    await execute({}, undefined);

    assert.equal(calls[0].url, "/api/thing/list");
    assert.equal(calls[0].init?.method, "GET");
  });

  it("overrides a toolName / uuid the server put in the body", async () => {
    replyWith(200, { message: "ok", toolName: "someOtherTool", uuid: "server-supplied-uuid" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    const result = await execute({}, {});

    assert.equal(result.toolName, TOOL_NAME);
    assert.notEqual(result.uuid, "server-supplied-uuid");
  });

  it("mints a fresh uuid per call", async () => {
    replyWith(200, { message: "ok" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    const first = await execute({}, {});
    const second = await execute({}, {});

    assert.ok(first.uuid);
    assert.notEqual(first.uuid, second.uuid);
  });

  it("omits the request body when args is undefined", async () => {
    replyWith(200, { message: "ok" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "list", TOOL_NAME);

    await execute({}, undefined);

    assert.equal(calls[0].init?.body, undefined);
  });

  it("passes an empty-object body through as {}", async () => {
    replyWith(200, { message: "ok" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    await execute({}, {});

    assert.equal(calls[0].init?.body, "{}");
  });
});

describe("makeRouteExecute — failure", () => {
  beforeEach(() => {
    installEndpoints();
    installFetchMock();
  });
  afterEach(restoreFetch);

  it("returns the server error as the message on an HTTP error", async () => {
    replyWith(500, { error: "disk full" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    const result = await execute({}, {});

    assert.equal(result.message, "disk full");
    assert.equal(result.toolName, TOOL_NAME);
    assert.ok(result.uuid);
  });

  it("carries no data on failure, so the host renders no card", async () => {
    replyWith(404, { error: "no such thing" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    const result = await execute({}, {});

    assert.equal(result.data, undefined);
    assert.equal(result.title, undefined);
  });

  it("surfaces a network error (fetch throws) as the message", async () => {
    nextResponse = () => {
      throw new Error("connection refused");
    };
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    const result = await execute({}, {});

    assert.equal(result.message, "connection refused");
    assert.equal(result.toolName, TOOL_NAME);
  });

  it("mints a fresh uuid per failed call too", async () => {
    replyWith(500, { error: "boom" });
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    const first = await execute({}, {});
    const second = await execute({}, {});

    assert.notEqual(first.uuid, second.uuid);
  });
});

describe("makePostExecute", () => {
  beforeEach(() => {
    installEndpoints();
    installFetchMock();
  });
  afterEach(restoreFetch);

  it("POSTs to the bare URL string the host group holds", async () => {
    replyWith(200, { message: "edited", data: { filePath: "artifacts/images/a.png" } });
    const execute = makePostExecute<ImageUrls, ThingData>("image", "edit", TOOL_NAME);

    const result = await execute({}, { prompt: "make it blue" });

    assert.equal(calls[0].url, "/api/image/edit");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.body, JSON.stringify({ prompt: "make it blue" }));
    assert.deepEqual(result.data, { filePath: "artifacts/images/a.png" });
    assert.equal(result.toolName, TOOL_NAME);
  });

  it("returns the error message on failure", async () => {
    replyWith(502, { error: "provider unavailable" });
    const execute = makePostExecute<ImageUrls, ThingData>("image", "generate", TOOL_NAME);

    const result = await execute({}, {});

    assert.equal(result.message, "provider unavailable");
    assert.equal(result.data, undefined);
  });
});

describe("endpoint resolution", () => {
  beforeEach(installFetchMock);
  afterEach(restoreFetch);

  // The host installs its context AFTER plugin modules load, so a
  // factory that resolved its endpoints eagerly would throw at import.
  it("resolves the endpoint group lazily, at call time", async () => {
    installEndpoints({});
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);
    installEndpoints();
    replyWith(200, { message: "ok" });

    const result = await execute({}, {});

    assert.equal(result.message, "ok");
    assert.equal(calls[0].url, "/api/thing");
  });

  it("throws on an unknown scope rather than calling an undefined URL", async () => {
    installEndpoints({});
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    await assert.rejects(() => execute({}, {}), /Unknown plugin endpoint scope: "thing"/);
    assert.equal(calls.length, 0);
  });
});

describe("execute shape", () => {
  beforeEach(() => {
    installEndpoints();
    installFetchMock();
  });
  afterEach(restoreFetch);

  // The factories exist to satisfy gui-chat-protocol's ToolPlugin
  // contract; a result missing `toolName` / `uuid` is not renderable.
  it("always returns a ToolResult with toolName and uuid populated", async () => {
    const execute = makeRouteExecute<ThingRoutes, ThingData>("thing", "create", TOOL_NAME);

    replyWith(200, { message: "ok" });
    const success: ToolResult<ThingData> = await execute({}, {});
    replyWith(500, { error: "boom" });
    const failure: ToolResult<ThingData> = await execute({}, {});

    [success, failure].forEach((result) => {
      assert.equal(result.toolName, TOOL_NAME);
      assert.equal(typeof result.uuid, "string");
      assert.equal(typeof result.message, "string");
    });
  });
});
