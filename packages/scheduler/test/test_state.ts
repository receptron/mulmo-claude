import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadState, saveState, updateAndSave, type StateDeps, type StateMap } from "../src/state.ts";
import { emptyState } from "../src/types.ts";

function inMemoryDeps(): StateDeps & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    readFile: async (p) => {
      const v = store.get(p);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
    writeFileAtomic: async (p, content) => {
      store.set(p, content);
    },
    exists: (p) => store.has(p),
  };
}

describe("loadState", () => {
  it("returns empty map when file doesn't exist", async () => {
    const deps = inMemoryDeps();
    const map = await loadState("/state.json", deps);
    assert.equal(map.size, 0);
  });

  it("parses a valid state file", async () => {
    const deps = inMemoryDeps();
    const state = {
      t1: { ...emptyState("t1"), lastRunAt: "2026-04-17T08:00:00Z" },
    };
    deps.store.set("/state.json", JSON.stringify(state));
    const map = await loadState("/state.json", deps);
    assert.equal(map.size, 1);
    assert.equal(map.get("t1")?.lastRunAt, "2026-04-17T08:00:00Z");
  });

  it("returns empty map on corrupt JSON", async () => {
    const deps = inMemoryDeps();
    deps.store.set("/state.json", "not json");
    const map = await loadState("/state.json", deps);
    assert.equal(map.size, 0);
  });
});

describe("saveState", () => {
  it("writes a JSON file from the map", async () => {
    const deps = inMemoryDeps();
    const map: StateMap = new Map([["t1", emptyState("t1")]]);
    await saveState("/state.json", map, deps);
    const raw = deps.store.get("/state.json")!;
    const parsed = JSON.parse(raw);
    assert.equal(parsed.t1.taskId, "t1");
  });
});

describe("updateAndSave", () => {
  it("patches a task's state and persists", async () => {
    const deps = inMemoryDeps();
    const map: StateMap = new Map([["t1", emptyState("t1")]]);
    await updateAndSave(
      "/state.json",
      map,
      "t1",
      {
        lastRunAt: "2026-04-17T08:00:00Z",
        lastRunResult: "success",
        totalRuns: 1,
      },
      deps,
    );
    assert.equal(map.get("t1")?.lastRunAt, "2026-04-17T08:00:00Z");
    assert.equal(map.get("t1")?.totalRuns, 1);
    // Also persisted
    const raw = deps.store.get("/state.json")!;
    assert.ok(raw.includes("2026-04-17T08:00:00Z"));
  });

  it("creates state for unknown taskId", async () => {
    const deps = inMemoryDeps();
    const map: StateMap = new Map();
    await updateAndSave(
      "/state.json",
      map,
      "new",
      {
        lastRunResult: "error",
      },
      deps,
    );
    assert.equal(map.get("new")?.lastRunResult, "error");
    assert.equal(map.get("new")?.taskId, "new");
  });
});
