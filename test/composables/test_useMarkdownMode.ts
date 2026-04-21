import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { useMarkdownMode } from "../../src/composables/useMarkdownMode.ts";

const STORAGE_KEY = "files_md_raw_mode";

// Minimal localStorage stub — useMarkdownMode only calls getItem/setItem.
const storage = new Map<string, string>();

const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);

function installStubStorage(): void {
  storage.clear();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
    },
    writable: true,
    configurable: true,
  });
}

function restoreStorage(): void {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(
      globalThis,
      "localStorage",
      originalLocalStorageDescriptor,
    );
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
}

describe("useMarkdownMode", () => {
  beforeEach(installStubStorage);
  afterEach(restoreStorage);

  it("defaults to rendered mode (mdRawMode === false) on first load", () => {
    const { mdRawMode } = useMarkdownMode();
    assert.equal(mdRawMode.value, false);
  });

  it("reads the persisted 'true' state from localStorage", () => {
    storage.set(STORAGE_KEY, "true");
    const { mdRawMode } = useMarkdownMode();
    assert.equal(mdRawMode.value, true);
  });

  it("treats any non-'true' value as false (incl. 'false', '1', garbage)", () => {
    for (const bad of ["false", "1", "", "TRUE", "yes"]) {
      storage.set(STORAGE_KEY, bad);
      const { mdRawMode } = useMarkdownMode();
      assert.equal(mdRawMode.value, false, `value=${JSON.stringify(bad)}`);
    }
  });

  it("toggleMdRaw flips the ref and persists the new value", () => {
    const { mdRawMode, toggleMdRaw } = useMarkdownMode();
    toggleMdRaw();
    assert.equal(mdRawMode.value, true);
    assert.equal(storage.get(STORAGE_KEY), "true");
    toggleMdRaw();
    assert.equal(mdRawMode.value, false);
    assert.equal(storage.get(STORAGE_KEY), "false");
  });

  it("multiple instances do not share state (each reads current storage)", () => {
    const a = useMarkdownMode();
    a.toggleMdRaw();
    const b = useMarkdownMode();
    assert.equal(b.mdRawMode.value, true);
    // b.toggleMdRaw only flips b; a.mdRawMode is its own ref.
    b.toggleMdRaw();
    assert.equal(b.mdRawMode.value, false);
    assert.equal(a.mdRawMode.value, true);
    assert.equal(storage.get(STORAGE_KEY), "false");
  });
});
