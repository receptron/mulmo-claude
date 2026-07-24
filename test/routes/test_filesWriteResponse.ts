// Unit tests for the shared write-route preamble + tail extracted from
// POST /api/files/create and PUT /api/files/content.
//
// Both helpers are driven with a recorded Response mock and injected
// deps (mirroring test_dispatchResponse.ts) — no filesystem, no
// pub-sub bus. The stat seam is what makes the two fallbacks
// (`fresh?.size ?? fallbackBytes`, `fresh?.mtimeMs ?? now()`)
// reachable without deleting a file mid-test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import { respondWithWrittenFile, validateWriteRequestOr400, type WrittenFileDeps } from "../../server/api/routes/filesWriteResponse.js";

interface RecordedResponse {
  statusCode: number;
  body: unknown;
  status: (code: number) => RecordedResponse;
  json: (payload: unknown) => RecordedResponse;
}

function makeRes(): RecordedResponse {
  const rec: RecordedResponse = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return rec;
}

const FROZEN_NOW_MS = 1_700_000_000_000;

interface RecordedDeps extends WrittenFileDeps {
  published: string[];
}

function makeDeps(fresh: { size: number; mtimeMs: number } | null): RecordedDeps {
  const published: string[] = [];
  return {
    published,
    stat: () => Promise.resolve(fresh),
    publish: (relPath) => published.push(relPath),
    now: () => FROZEN_NOW_MS,
  };
}

const WRITTEN = { absPath: "/ws/notes/a.md", relPath: "notes/a.md", fallbackBytes: 42, logLabel: "PUT content" };

describe("respondWithWrittenFile — stat succeeds", () => {
  it("answers with the on-disk size and mtime, not the fallbacks", async () => {
    const res = makeRes();
    const deps = makeDeps({ size: 57, mtimeMs: 1234 });
    await respondWithWrittenFile(res as unknown as Response, WRITTEN, deps);
    assert.deepEqual(res.body, { path: "notes/a.md", size: 57, modifiedMs: 1234 });
  });

  it("publishes the written path exactly once", async () => {
    const res = makeRes();
    const deps = makeDeps({ size: 57, mtimeMs: 1234 });
    await respondWithWrittenFile(res as unknown as Response, WRITTEN, deps);
    assert.deepEqual(deps.published, ["notes/a.md"]);
  });

  it("keeps a wiki-stamped size (stat differs from the submitted bytes)", async () => {
    const res = makeRes();
    // writeWikiPage prepends frontmatter, so on-disk > submitted.
    const deps = makeDeps({ size: 200, mtimeMs: 9 });
    await respondWithWrittenFile(res as unknown as Response, { ...WRITTEN, fallbackBytes: 100 }, deps);
    assert.deepEqual(res.body, { path: "notes/a.md", size: 200, modifiedMs: 9 });
  });
});

describe("respondWithWrittenFile — stat returns null", () => {
  it("falls back to the submitted byte count and the injected clock", async () => {
    const res = makeRes();
    const deps = makeDeps(null);
    await respondWithWrittenFile(res as unknown as Response, WRITTEN, deps);
    assert.deepEqual(res.body, { path: "notes/a.md", size: 42, modifiedMs: FROZEN_NOW_MS });
  });

  it("still publishes exactly once — a failed stat is not a failed write", async () => {
    const res = makeRes();
    const deps = makeDeps(null);
    await respondWithWrittenFile(res as unknown as Response, WRITTEN, deps);
    assert.deepEqual(deps.published, ["notes/a.md"]);
  });
});

describe("respondWithWrittenFile — zero-byte content", () => {
  it("reports size 0 from stat rather than coalescing to the fallback", async () => {
    const res = makeRes();
    const deps = makeDeps({ size: 0, mtimeMs: 77 });
    await respondWithWrittenFile(res as unknown as Response, { ...WRITTEN, fallbackBytes: 42 }, deps);
    assert.deepEqual(res.body, { path: "notes/a.md", size: 0, modifiedMs: 77 });
  });

  it("reports size 0 from the fallback when stat is null", async () => {
    const res = makeRes();
    const deps = makeDeps(null);
    await respondWithWrittenFile(res as unknown as Response, { ...WRITTEN, fallbackBytes: 0 }, deps);
    assert.deepEqual(res.body, { path: "notes/a.md", size: 0, modifiedMs: FROZEN_NOW_MS });
  });

  it("treats mtimeMs 0 as a real timestamp, not a missing one", async () => {
    const res = makeRes();
    const deps = makeDeps({ size: 3, mtimeMs: 0 });
    await respondWithWrittenFile(res as unknown as Response, WRITTEN, deps);
    assert.deepEqual(res.body, { path: "notes/a.md", size: 3, modifiedMs: 0 });
  });
});

describe("respondWithWrittenFile — ordering", () => {
  it("publishes before answering, so a subscriber can't miss the write", async () => {
    const order: string[] = [];
    const res = makeRes();
    const recordingRes = {
      ...res,
      json(payload: unknown) {
        order.push("json");
        return res.json(payload);
      },
    };
    const deps: WrittenFileDeps = {
      stat: () => Promise.resolve({ size: 1, mtimeMs: 2 }),
      publish: () => order.push("publish"),
      now: () => FROZEN_NOW_MS,
    };
    await respondWithWrittenFile(recordingRes as unknown as Response, WRITTEN, deps);
    assert.deepEqual(order, ["publish", "json"]);
  });
});

describe("validateWriteRequestOr400", () => {
  it("returns the narrowed inputs with the utf-8 byte count", () => {
    const res = makeRes();
    const inputs = validateWriteRequestOr400({ path: "notes/a.md", content: "あ" }, res as unknown as Response, "POST create");
    assert.deepEqual(inputs, { relPath: "notes/a.md", content: "あ", bytes: 3 });
    assert.equal(res.body, undefined, "a valid body must not write a response");
  });

  it("accepts empty content (0 bytes) — an empty file is a legal write", () => {
    const res = makeRes();
    const inputs = validateWriteRequestOr400({ path: "notes/a.md", content: "" }, res as unknown as Response, "POST create");
    assert.deepEqual(inputs, { relPath: "notes/a.md", content: "", bytes: 0 });
  });

  it("writes 400 and returns null when path is missing", () => {
    const res = makeRes();
    const inputs = validateWriteRequestOr400({ content: "x" }, res as unknown as Response, "POST create");
    assert.equal(inputs, null);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "path required" });
  });

  it("writes 400 and returns null when content is missing", () => {
    const res = makeRes();
    const inputs = validateWriteRequestOr400({ path: "notes/a.md" }, res as unknown as Response, "PUT content");
    assert.equal(inputs, null);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "content required" });
  });

  it("rejects a null body without throwing", () => {
    const res = makeRes();
    assert.equal(validateWriteRequestOr400(null, res as unknown as Response, "PUT content"), null);
    assert.equal(res.statusCode, 400);
  });

  it("rejects content over the 1 MB cap", () => {
    const res = makeRes();
    const oversized = "a".repeat(1024 * 1024 + 1);
    assert.equal(validateWriteRequestOr400({ path: "notes/a.md", content: oversized }, res as unknown as Response, "PUT content"), null);
    assert.equal(res.statusCode, 400);
  });
});
