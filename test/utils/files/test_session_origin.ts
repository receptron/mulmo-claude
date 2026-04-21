import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import { createSessionMeta, backfillOrigin, readSessionMeta } from "../../../server/utils/files/session-io.ts";

function tmpRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "session-origin-"));
  mkdirSync(path.join(dir, "conversations", "chat"), { recursive: true });
  return dir;
}

describe("createSessionMeta — origin", () => {
  it("writes origin when provided", async () => {
    const root = tmpRoot();
    await createSessionMeta("s1", "general", "hello", root, "bridge");
    const meta = await readSessionMeta("s1", root);
    assert.equal(meta?.origin, "bridge");
  });

  it("omits origin when not provided", async () => {
    const root = tmpRoot();
    await createSessionMeta("s2", "general", "hello", root);
    const meta = await readSessionMeta("s2", root);
    assert.equal(meta?.origin, undefined);
  });

  it("writes skill origin", async () => {
    const root = tmpRoot();
    await createSessionMeta("s3", "general", "hello", root, "skill");
    const meta = await readSessionMeta("s3", root);
    assert.equal(meta?.origin, "skill");
  });

  it("writes scheduler origin", async () => {
    const root = tmpRoot();
    await createSessionMeta("s4", "general", "hello", root, "scheduler");
    const meta = await readSessionMeta("s4", root);
    assert.equal(meta?.origin, "scheduler");
  });
});

describe("backfillOrigin", () => {
  it("sets origin on session without one", async () => {
    const root = tmpRoot();
    await createSessionMeta("b1", "general", "hello", root);
    const before = await readSessionMeta("b1", root);
    assert.equal(before?.origin, undefined);

    await backfillOrigin("b1", "bridge", root);
    const after = await readSessionMeta("b1", root);
    assert.equal(after?.origin, "bridge");
  });

  it("does not overwrite existing origin", async () => {
    const root = tmpRoot();
    await createSessionMeta("b2", "general", "hello", root, "skill");
    await backfillOrigin("b2", "bridge", root);
    const meta = await readSessionMeta("b2", root);
    assert.equal(meta?.origin, "skill"); // unchanged
  });

  it("no-ops on missing session", async () => {
    const root = tmpRoot();
    await backfillOrigin("nonexistent", "bridge", root);
    // should not throw
  });
});
