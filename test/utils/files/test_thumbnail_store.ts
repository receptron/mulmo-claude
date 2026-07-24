// Unit tests for the remote-view thumbnail resolver (phase 5 —
// plans/done/feat-remote-view-images.md). The resize step is injected so no native
// `sharp` binary is needed; the test exercises workspace containment, the
// mtime-keyed cache, and the graceful-null failure paths against real temp files
// under the workspace root.
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { workspacePath } from "../../../server/workspace/paths.js";
import { clearThumbnailCache, createThumbnailResolver, type ResizeToJpeg } from "../../../server/utils/files/thumbnail-store.js";

const DIR_REL = "thumb-test";
const DIR_ABS = path.join(workspacePath, DIR_REL);

// A spy resize that records the edges it was called with and echoes them (the
// source bytes are irrelevant — real decoding is sharp's job, stubbed out here).
function spyResize(): ResizeToJpeg & { calls: number[] } {
  const calls: number[] = [];
  const resize = (async (_input: Buffer, maxEdge: number) => {
    calls.push(maxEdge);
    return Buffer.from(`resized@${maxEdge}`);
  }) as ResizeToJpeg & { calls: number[] };
  resize.calls = calls;
  return resize;
}

beforeEach(async () => {
  clearThumbnailCache();
  await mkdir(DIR_ABS, { recursive: true });
  await writeFile(path.join(DIR_ABS, "pic.png"), Buffer.from("not-a-real-png-but-fine"));
});

afterEach(async () => {
  await rm(DIR_ABS, { recursive: true, force: true });
});

describe("resolveThumbnail", () => {
  it("resolves a workspace image to a JPEG data URL, passing the requested edge to resize", async () => {
    const resize = spyResize();
    const resolve = createThumbnailResolver(resize);
    const dataUrl = await resolve(`${DIR_REL}/pic.png`, 384);
    assert.equal(resize.calls.length, 1);
    assert.deepEqual(resize.calls, [384]);
    assert.equal(dataUrl, `data:image/jpeg;base64,${Buffer.from("resized@384").toString("base64")}`);
  });

  it("serves a second call for the same (path, mtime, edge) from cache without re-encoding", async () => {
    const resize = spyResize();
    const resolve = createThumbnailResolver(resize);
    const first = await resolve(`${DIR_REL}/pic.png`, 512);
    const second = await resolve(`${DIR_REL}/pic.png`, 512);
    assert.equal(first, second);
    assert.equal(resize.calls.length, 1); // second was a cache hit
  });

  it("re-encodes when the requested edge differs (distinct cache key)", async () => {
    const resize = spyResize();
    const resolve = createThumbnailResolver(resize);
    await resolve(`${DIR_REL}/pic.png`, 256);
    await resolve(`${DIR_REL}/pic.png`, 512);
    assert.deepEqual(resize.calls, [256, 512]);
  });

  it("returns null for a path escaping the workspace, without calling resize", async () => {
    const resize = spyResize();
    const resolve = createThumbnailResolver(resize);
    assert.equal(await resolve("../../etc/passwd", 512), null);
    assert.equal(resize.calls.length, 0);
  });

  it("returns null for a missing file", async () => {
    const resolve = createThumbnailResolver(spyResize());
    assert.equal(await resolve(`${DIR_REL}/nope.png`, 512), null);
  });

  it("returns null (not throw) when resize fails", async () => {
    const resolve = createThumbnailResolver(async () => {
      throw new Error("unsupported image");
    });
    assert.equal(await resolve(`${DIR_REL}/pic.png`, 512), null);
  });
});
