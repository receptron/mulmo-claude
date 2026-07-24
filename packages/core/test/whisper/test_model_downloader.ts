import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createModelDownloader, modelFilePath, type WhisperModelName } from "../../src/whisper/models.ts";

// Drive the module-scope `downloadModel` / `streamToFile` through the only
// public seam (`createModelDownloader().ensure`), stubbing `globalThis.fetch`
// and writing into a throwaway temp dir. "base" is the smallest registered
// model; its multi-hundred-MB size floor is what every failure path here trips.
const MODEL: WhisperModelName = "base";

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function makeModelsDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "whisper-models-"));
  tempDirs.push(dir);
  return dir;
}

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function streamFromController(): { body: ReadableStream<Uint8Array>; push: (bytes: number) => void; close: () => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  return { body, push: (bytes) => controller.enqueue(new Uint8Array(bytes)), close: () => controller.close() };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  // maxRetries: the stall-abort test's async partial-file cleanup can still
  // be mid-flight here; a file reappearing while rm walks the dir throws a
  // transient ENOTEMPTY (seen on CI). rmSync retries exactly that class.
  tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
});

describe("createModelDownloader.ensure — download orchestration", () => {
  it("rejects and cleans up a body below the size floor", async () => {
    globalThis.fetch = async () => new Response(new Uint8Array(1024));
    const dir = makeModelsDir();
    const downloader = createModelDownloader(dir);

    await downloader.ensure(MODEL);

    const status = downloader.getStatus(MODEL);
    assert.equal(status.state, "error");
    assert.match(status.error ?? "", /smaller than expected/);
    assert.equal(existsSync(`${modelFilePath(dir, MODEL)}.partial`), false);
    assert.equal(existsSync(modelFilePath(dir, MODEL)), false);
  });

  it("reports an HTTP error without creating a partial file", async () => {
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const dir = makeModelsDir();
    const downloader = createModelDownloader(dir);

    await downloader.ensure(MODEL);

    const status = downloader.getStatus(MODEL);
    assert.equal(status.state, "error");
    assert.match(status.error ?? "", /HTTP 503/);
    assert.equal(existsSync(`${modelFilePath(dir, MODEL)}.partial`), false);
  });

  it("publishes fractional progress while streaming a known content length", async () => {
    // A chunk under the fs write high-water mark (16 KiB) keeps `write` from
    // returning false, so progress lands without waiting on a `drain` event.
    const total = 40_000;
    const source = streamFromController();
    globalThis.fetch = async () => new Response(source.body, { headers: { "content-length": String(total) } });
    const dir = makeModelsDir();
    const downloader = createModelDownloader(dir);

    const done = downloader.ensure(MODEL);
    source.push(10_000);
    await flushMicrotasks();
    await flushMicrotasks();

    const mid = downloader.getStatus(MODEL);
    assert.equal(mid.state, "downloading");
    assert.ok(mid.progress !== undefined && mid.progress > 0 && mid.progress < 1, `progress ${mid.progress} should be a fraction`);

    source.close();
    await done;
  });

  it("does not start a second download while one is already in flight", async () => {
    let fetchCalls = 0;
    const source = streamFromController();
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(source.body, { headers: { "content-length": "1024" } });
    };
    const dir = makeModelsDir();
    const downloader = createModelDownloader(dir);

    const first = downloader.ensure(MODEL);
    await downloader.ensure(MODEL);
    assert.equal(fetchCalls, 1);

    source.close();
    await first;
  });

  it("absorbs a partial-file open that fails after the stream already errored", async () => {
    // The stream errors synchronously, so `streamToFile` destroys the write
    // stream while `createWriteStream`'s open() is still in libuv's threadpool.
    // Removing the dir makes that open land ENOENT — it must not escape as an
    // uncaughtException (node:test would fail the whole file).
    globalThis.fetch = async () => {
      const errored = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("stream died"));
        },
      });
      return new Response(errored, { headers: { "content-length": "1024" } });
    };
    const dir = makeModelsDir();
    const downloader = createModelDownloader(dir);

    await downloader.ensure(MODEL);
    rmSync(dir, { recursive: true, force: true });
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    assert.equal(downloader.getStatus(MODEL).state, "error");
  });

  it("aborts a stalled download once the stall timeout elapses", async (ctx) => {
    mock.timers.enable({ apis: ["setTimeout"] });
    ctx.after(() => mock.timers.reset());

    globalThis.fetch = async (_input, init) => {
      const signal = init?.signal;
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(new Error("stalled")));
        },
      });
      return new Response(stalled, { headers: { "content-length": "1024" } });
    };
    const dir = makeModelsDir();
    const downloader = createModelDownloader(dir);

    const done = downloader.ensure(MODEL);
    await flushMicrotasks();
    await flushMicrotasks();
    mock.timers.tick(60_000);
    await done;

    const status = downloader.getStatus(MODEL);
    assert.equal(status.state, "error");
    assert.equal(existsSync(modelFilePath(dir, MODEL)), false);
  });
});
