// Canonical tests for the shared translation loader (#2460). Imports the
// SOURCE (not the built `@mulmoclaude/core/translation/client`) so a broken
// guard here fails without a rebuild. Both hosts of the loader — the
// MulmoClaude composable and the collection-plugin starter modal — route
// their peek-then-fetch flow through `loadTranslated`, so these assertions
// pin the staleness guard and the rejection swallow in one place.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTranslationCache, loadTranslated, type TranslateRequest, type TranslationCache } from "../../src/translation/client.ts";

const REQ: TranslateRequest = { namespace: "ns", targetLanguage: "ja", sentences: ["Hello", "World"] };

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface FakeCacheOptions {
  peekResult?: readonly string[] | null;
  fetchResult?: Promise<readonly string[] | null>;
}

function makeFakeCache(options: FakeCacheOptions): { cache: TranslationCache; fetchCalls: TranslateRequest[] } {
  const fetchCalls: TranslateRequest[] = [];
  const cache: TranslationCache = {
    peek: () => options.peekResult ?? null,
    fetch: (req) => {
      fetchCalls.push(req);
      return options.fetchResult ?? Promise.resolve(null);
    },
    clear: () => {},
  };
  return { cache, fetchCalls };
}

describe("loadTranslated", () => {
  it("applies a peek hit synchronously without fetching", () => {
    const hit = ["こんにちは", "世界"];
    const { cache, fetchCalls } = makeFakeCache({ peekResult: hit });
    const applied: (readonly string[])[] = [];
    loadTranslated(
      cache,
      REQ,
      () => true,
      (value) => applied.push(value),
    );
    assert.deepEqual(applied, [hit]);
    assert.equal(fetchCalls.length, 0);
  });

  it("fetches on a peek miss and applies the resolved value while current", async () => {
    const fetched = ["こんにちは", "世界"];
    const { cache, fetchCalls } = makeFakeCache({ fetchResult: Promise.resolve(fetched) });
    const applied: (readonly string[])[] = [];
    loadTranslated(
      cache,
      REQ,
      () => true,
      (value) => applied.push(value),
    );
    assert.deepEqual(applied, []); // nothing applied before the fetch resolves
    await flushMicrotasks();
    assert.deepEqual(applied, [fetched]);
    assert.deepEqual(fetchCalls, [REQ]);
  });

  it("discards a fetched value when isCurrent() has turned false (stale response)", async () => {
    const { cache } = makeFakeCache({ fetchResult: Promise.resolve(["stale"]) });
    const applied: (readonly string[])[] = [];
    loadTranslated(
      cache,
      { ...REQ, sentences: ["Old"] },
      () => false,
      (value) => applied.push(value),
    );
    await flushMicrotasks();
    assert.deepEqual(applied, []);
  });

  it("does not apply a null fetch result (transport failure signalled via null)", async () => {
    const { cache } = makeFakeCache({ fetchResult: Promise.resolve(null) });
    const applied: (readonly string[])[] = [];
    loadTranslated(
      cache,
      REQ,
      () => true,
      (value) => applied.push(value),
    );
    await flushMicrotasks();
    assert.deepEqual(applied, []);
  });

  it("swallows a rejected fetch (no unhandled rejection, apply never called)", async () => {
    const { cache } = makeFakeCache({ fetchResult: Promise.reject(new Error("network down")) });
    const applied: (readonly string[])[] = [];
    loadTranslated(
      cache,
      REQ,
      () => true,
      (value) => applied.push(value),
    );
    await flushMicrotasks();
    assert.deepEqual(applied, []);
  });

  it("resolves an empty request through a real cache and applies the empty batch", async () => {
    const cache = createTranslationCache(() => Promise.resolve({ translations: [] }));
    const emptyReq: TranslateRequest = { namespace: "ns", targetLanguage: "ja", sentences: [] };
    const emptyBatch: readonly string[] = [];
    const applied: (readonly string[])[] = [];
    loadTranslated(
      cache,
      emptyReq,
      () => true,
      (value) => applied.push(value),
    );
    await flushMicrotasks();
    assert.deepEqual(applied, [emptyBatch]);
    // A second load hits the memo via peek — applied synchronously.
    loadTranslated(
      cache,
      emptyReq,
      () => true,
      (value) => applied.push(value),
    );
    assert.deepEqual(applied, [emptyBatch, emptyBatch]);
  });

  it("integrates with createTranslationCache: fetch then memoized peek, guard evaluated per call", async () => {
    const transportCalls: TranslateRequest[] = [];
    const cache = createTranslationCache((req) => {
      transportCalls.push(req);
      return Promise.resolve({ translations: ["こんにちは", "世界"] });
    });
    const applied: (readonly string[])[] = [];
    loadTranslated(
      cache,
      REQ,
      () => true,
      (value) => applied.push(value),
    );
    await flushMicrotasks();
    loadTranslated(
      cache,
      REQ,
      () => true,
      (value) => applied.push(value),
    );
    assert.deepEqual(applied, [
      ["こんにちは", "世界"],
      ["こんにちは", "世界"],
    ]);
    assert.equal(transportCalls.length, 1); // second call served from the memo, no re-fetch
  });
});
