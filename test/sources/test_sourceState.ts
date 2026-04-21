import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSourceState,
  writeSourceState,
  readManyStates,
  writeManyStates,
  deleteSourceState,
  validateSourceState,
} from "../../server/workspace/sources/sourceState.js";
import { sourceStatePath } from "../../server/workspace/sources/paths.js";
import { defaultSourceState, type SourceState } from "../../server/workspace/sources/types.js";

// --- validateSourceState (pure) ------------------------------------------

describe("validateSourceState", () => {
  it("returns default state for non-object input", () => {
    assert.deepEqual(validateSourceState(null, "s"), defaultSourceState("s"));
    assert.deepEqual(validateSourceState("string", "s"), defaultSourceState("s"));
    assert.deepEqual(validateSourceState([1, 2, 3], "s"), defaultSourceState("s"));
  });

  it("parses a complete state object", () => {
    const out = validateSourceState(
      {
        slug: "original-slug-ignored",
        lastFetchedAt: "2026-04-13T10:00:00Z",
        cursor: { key: "value" },
        consecutiveFailures: 2,
        nextAttemptAt: "2026-04-13T11:00:00Z",
      },
      "s",
    );
    // slug always comes from the function argument — the file
    // contents' own `slug` is ignored so a renamed file can't
    // produce a state with an inconsistent slug.
    assert.equal(out.slug, "s");
    assert.equal(out.lastFetchedAt, "2026-04-13T10:00:00Z");
    assert.deepEqual(out.cursor, { key: "value" });
    assert.equal(out.consecutiveFailures, 2);
    assert.equal(out.nextAttemptAt, "2026-04-13T11:00:00Z");
  });

  it("coerces missing fields to defaults", () => {
    const out = validateSourceState({}, "s");
    assert.equal(out.lastFetchedAt, null);
    assert.deepEqual(out.cursor, {});
    assert.equal(out.consecutiveFailures, 0);
    assert.equal(out.nextAttemptAt, null);
  });

  it("rejects non-numeric / negative consecutiveFailures", () => {
    assert.equal(validateSourceState({ consecutiveFailures: "many" }, "s").consecutiveFailures, 0);
    assert.equal(validateSourceState({ consecutiveFailures: -5 }, "s").consecutiveFailures, 0);
  });

  it("floors fractional consecutiveFailures", () => {
    const out = validateSourceState({ consecutiveFailures: 2.9 }, "s");
    assert.equal(out.consecutiveFailures, 2);
  });

  it("drops non-string values from cursor", () => {
    const out = validateSourceState(
      {
        cursor: { valid: "ok", number_bad: 42, obj_bad: { nested: true } },
      },
      "s",
    );
    assert.deepEqual(out.cursor, { valid: "ok" });
  });

  it("rejects non-object cursor", () => {
    assert.deepEqual(validateSourceState({ cursor: "not-an-object" }, "s").cursor, {});
    assert.deepEqual(validateSourceState({ cursor: [1, 2, 3] }, "s").cursor, {});
  });
});

// --- filesystem tests ---------------------------------------------------

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "source-state-test-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function makeState(over: Partial<SourceState> = {}): SourceState {
  return {
    slug: "s",
    lastFetchedAt: "2026-04-13T10:00:00Z",
    cursor: { k: "v" },
    consecutiveFailures: 1,
    nextAttemptAt: null,
    ...over,
  };
}

describe("readSourceState", () => {
  it("returns default state when the file doesn't exist", async () => {
    const state = await readSourceState(workspace, "missing");
    assert.deepEqual(state, defaultSourceState("missing"));
  });

  it("returns default state for an invalid slug (path traversal defense)", async () => {
    const state = await readSourceState(workspace, "../etc/passwd");
    assert.deepEqual(state, defaultSourceState("../etc/passwd"));
  });

  it("returns default state when the file isn't JSON", async () => {
    // Manually plant a corrupted state file.
    const target = sourceStatePath(workspace, "corrupt");
    mkdirSync(join(workspace, "sources", "_state"), { recursive: true });
    writeFileSync(target, "{ not json");
    const state = await readSourceState(workspace, "corrupt");
    assert.deepEqual(state, defaultSourceState("corrupt"));
  });

  it("round-trips a written state", async () => {
    await writeSourceState(workspace, makeState());
    const roundtripped = await readSourceState(workspace, "s");
    assert.deepEqual(roundtripped, makeState());
  });
});

describe("writeSourceState", () => {
  it("creates parent dirs and writes atomic", async () => {
    await writeSourceState(workspace, makeState());
    const raw = await readFile(sourceStatePath(workspace, "s"), "utf-8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.slug, "s");
  });

  it("rejects an invalid slug", async () => {
    const bad: SourceState = { ...makeState(), slug: "../etc" };
    await assert.rejects(() => writeSourceState(workspace, bad), /invalid slug/);
  });

  it("overwrites an existing state", async () => {
    await writeSourceState(workspace, makeState({ consecutiveFailures: 1 }));
    await writeSourceState(workspace, makeState({ consecutiveFailures: 5 }));
    const state = await readSourceState(workspace, "s");
    assert.equal(state.consecutiveFailures, 5);
  });
});

describe("readManyStates / writeManyStates", () => {
  it("round-trips multiple states in one call", async () => {
    const states = [
      makeState({ slug: "a", consecutiveFailures: 1 }),
      makeState({ slug: "b", consecutiveFailures: 2 }),
      makeState({ slug: "c", consecutiveFailures: 3 }),
    ];
    const { written, errors } = await writeManyStates(workspace, states);
    assert.equal(written, 3);
    assert.deepEqual(errors, []);

    const reads = await readManyStates(workspace, ["a", "b", "c"]);
    assert.equal(reads.get("a")!.consecutiveFailures, 1);
    assert.equal(reads.get("b")!.consecutiveFailures, 2);
    assert.equal(reads.get("c")!.consecutiveFailures, 3);
  });

  it("absorbs per-state write failures", async () => {
    const states = [
      makeState({ slug: "ok" }),
      // Invalid slug → write throws, gets caught.
      { ...makeState(), slug: "../etc" },
    ];
    const { written, errors } = await writeManyStates(workspace, states);
    assert.equal(written, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /invalid slug/);
  });

  it("returns default state for slugs not on disk", async () => {
    await writeSourceState(workspace, makeState({ slug: "has-state" }));
    const reads = await readManyStates(workspace, ["has-state", "no-state"]);
    assert.equal(reads.get("has-state")!.consecutiveFailures, 1);
    assert.deepEqual(reads.get("no-state"), defaultSourceState("no-state"));
  });
});

describe("deleteSourceState", () => {
  it("removes an existing state file and returns true", async () => {
    await writeSourceState(workspace, makeState());
    const removed = await deleteSourceState(workspace, "s");
    assert.equal(removed, true);
    const after = await readSourceState(workspace, "s");
    assert.deepEqual(after, defaultSourceState("s"));
  });

  it("returns false when the file doesn't exist", async () => {
    const removed = await deleteSourceState(workspace, "nothing");
    assert.equal(removed, false);
  });

  it("returns false for an invalid slug", async () => {
    const removed = await deleteSourceState(workspace, "../etc/passwd");
    assert.equal(removed, false);
  });
});
