// Unit tests for `loadPageEdit` — the loader that powers the new
// `page-edit` action (Stage 3a, #963). Covers the three branches:
// snapshot found / snapshot gc'd → live page fallback / both gone.
//
// Stubs `globalThis.fetch` since `apiGet` (the loader's transport)
// goes through the global. Same pattern as test_useSkillsList.ts.

import { describe, it, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { loadPageEdit } from "../../../src/plugins/wiki/pageEditLoader.js";
import { installTestHostContext } from "../../helpers/installHostContext.js";

before(() => {
  installTestHostContext();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalFetch: any = (globalThis as { fetch: unknown }).fetch;

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = originalFetch;
});

function stubFetch(impl: (input: string, init?: unknown) => Promise<Response>): void {
  (globalThis as { fetch: unknown }).fetch = impl as unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("loadPageEdit — snapshot present", () => {
  it("returns kind:snapshot with serialized content + timestamp", async () => {
    stubFetch(async (url) => {
      if (typeof url === "string" && url.includes("/history/")) {
        return jsonResponse(200, {
          slug: "topic",
          snapshot: {
            stamp: "2026-04-30T12-00-00-000Z-abc12345",
            ts: "2026-04-30T12:00:00.000Z",
            editor: "llm",
            bytes: 12,
            meta: { title: "Topic" },
            body: "snapshot body\n",
          },
        });
      }
      throw new Error(`unexpected url: ${String(url)}`);
    });

    const result = await loadPageEdit("topic", "2026-04-30T12-00-00-000Z-abc12345");
    assert.equal(result.kind, "snapshot");
    if (result.kind !== "snapshot") return;
    assert.equal(result.ts, "2026-04-30T12:00:00.000Z");
    assert.match(result.content, /^---/, "content should include serialized frontmatter prefix");
    assert.match(result.content, /title: Topic/);
    assert.match(result.content, /snapshot body/);
  });
});

describe("loadPageEdit — snapshot gc'd", () => {
  it("falls back to the live page on snapshot 404", async () => {
    stubFetch(async (url) => {
      if (typeof url === "string" && url.includes("/history/")) {
        return jsonResponse(404, { error: "not found" });
      }
      // Live-page GET returns the current content
      return jsonResponse(200, {
        data: {
          action: "page",
          title: "Topic",
          content: "---\ntitle: Topic\n---\n\ncurrent body\n",
          pageExists: true,
        },
      });
    });

    const result = await loadPageEdit("topic", "missing-stamp");
    assert.equal(result.kind, "current");
    if (result.kind !== "current") return;
    assert.match(result.content, /current body/);
  });

  it("returns kind:deleted when the live page is also gone", async () => {
    stubFetch(async (url) => {
      if (typeof url === "string" && url.includes("/history/")) {
        return jsonResponse(404, { error: "not found" });
      }
      return jsonResponse(200, {
        data: { action: "page", title: "Gone", content: "", pageExists: false },
      });
    });

    const result = await loadPageEdit("gone", "stamp");
    assert.equal(result.kind, "deleted");
  });
});

describe("loadPageEdit — transient failure", () => {
  // A 5xx on both the snapshot and the live-page fallback is a transient
  // outage, not a deletion — reporting "deleted" for a page that exists is a
  // factual lie the user can't recover from. Now surfaced as "error".
  it("treats a transient snapshot + live-page failure as error, not deleted", async () => {
    stubFetch(async () => jsonResponse(500, { error: "server exploded" }));
    const result = await loadPageEdit("topic", "stamp");
    assert.equal(result.kind, "error");
  });

  it("still recovers via the live page when only the snapshot 5xx's", async () => {
    stubFetch(async (url) => {
      if (typeof url === "string" && url.includes("/history/")) {
        return jsonResponse(503, { error: "snapshot store down" });
      }
      return jsonResponse(200, { data: { action: "page", title: "T", content: "# live", pageExists: true } });
    });
    const result = await loadPageEdit("topic", "stamp");
    assert.equal(result.kind, "current");
  });
});
