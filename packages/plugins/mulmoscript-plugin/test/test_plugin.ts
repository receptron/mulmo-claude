import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FileOps } from "gui-chat-protocol";
import { executeMulmoScript, executeMulmoScriptSave, executeUpdateBeat, executeUpdateScript } from "../src/core/plugin";
import type { MulmoScriptExecuteContext } from "../src/core/types";

// Minimal script / beat objects that satisfy the zod schemas from
// `@mulmocast/types` (same fixtures as test_validate.ts).
const VALID_BEAT = {
  speaker: "Narrator",
  text: "Beat one.",
  image: {
    type: "textSlide",
    slide: { title: "Slide 1", bullets: ["one"] },
  },
};

const VALID_SCRIPT = {
  $mulmocast: { version: "1.1" },
  title: "Test Story",
  description: "A test script",
  lang: "en",
  beats: [VALID_BEAT, { ...VALID_BEAT, text: "Beat two." }],
  imageParams: {},
};

/** In-memory FileOps double — only the members the phase-1 core touches
 *  (read / write / exists) do real work. */
function makeFakeContext(seed: Record<string, string> = {}): { context: MulmoScriptExecuteContext; store: Map<string, string> } {
  const store = new Map(Object.entries(seed));
  const artifacts: FileOps = {
    read: async (rel) => {
      const hit = store.get(rel);
      if (hit === undefined) throw new Error(`ENOENT: ${rel}`);
      return hit;
    },
    readBytes: async () => new Uint8Array(),
    write: async (rel, content) => {
      store.set(rel, typeof content === "string" ? content : Buffer.from(content).toString("utf-8"));
    },
    readDir: async () => [],
    stat: async () => ({ mtimeMs: 0, size: 0 }),
    exists: async (rel) => store.has(rel),
    unlink: async (rel) => {
      store.delete(rel);
    },
  };
  return { context: { files: { artifacts } }, store };
}

const NOW = new Date(1700000000000);

describe("executeMulmoScriptSave — mode selection", () => {
  it("rejects both script and filePath", async () => {
    const { context } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, { script: VALID_SCRIPT, filePath: "stories/x.json" }, NOW);
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "Provide either `script` or `filePath`, not both." });
  });

  it("rejects neither script nor filePath", async () => {
    const { context } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, {}, NOW);
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /Provide either `script` \(new presentation\)/);
  });
});

describe("executeMulmoScriptSave — create new", () => {
  it("saves a valid script under stories/ and returns the wire path", async () => {
    const { context, store } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, { script: VALID_SCRIPT }, NOW);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.filePath, "stories/test-story-1700000000000.json");
      assert.equal(out.message, "Saved MulmoScript to stories/test-story-1700000000000.json");
      assert.ok(store.has(out.filePath));
      assert.equal(JSON.parse(store.get(out.filePath) as string).title, "Test Story");
    }
  });

  it("prefers an explicit filename (stripping .json) over the title slug", async () => {
    const { context } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, { script: VALID_SCRIPT, filename: "My File.JSON" }, NOW);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.filePath, "stories/my-file-1700000000000.json");
  });

  it("rejects a script that fails the schema", async () => {
    const { context } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, { script: { completelyBogus: true } }, NOW);
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "script is not a valid MulmoScript" });
  });
});

describe("executeMulmoScriptSave — reopen existing", () => {
  const seed = { "stories/x.json": JSON.stringify(VALID_SCRIPT) };

  it("loads and validates an existing script", async () => {
    const { context } = makeFakeContext(seed);
    const out = await executeMulmoScriptSave(context, { filePath: "stories/x.json" });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.filePath, "stories/x.json");
      assert.equal(out.message, "Loaded MulmoScript from stories/x.json");
      assert.equal(out.script.title, "Test Story");
    }
  });

  it("accepts a bare filename and canonicalizes the wire path", async () => {
    const { context } = makeFakeContext(seed);
    const out = await executeMulmoScriptSave(context, { filePath: "x.json" });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.filePath, "stories/x.json");
  });

  it("404s a missing file", async () => {
    const { context } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, { filePath: "stories/nope.json" });
    assert.deepEqual(out, { ok: false, code: "not_found", error: "File not found: stories/nope.json" });
  });

  it("rejects a non-.json path", async () => {
    const { context } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, { filePath: "stories/movie.mp4" });
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "filePath must point to a .json file" });
  });

  it("rejects traversal paths", async () => {
    const { context } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, { filePath: "stories/../../etc/passwd.json" });
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "Invalid filePath" });
  });

  it("rejects a file with invalid JSON", async () => {
    const { context } = makeFakeContext({ "stories/broken.json": "{not json" });
    const out = await executeMulmoScriptSave(context, { filePath: "stories/broken.json" });
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.code, "bad_request");
      assert.match(out.error, /^Invalid JSON:/);
    }
  });

  it("rejects a JSON file that is not a MulmoScript", async () => {
    const { context } = makeFakeContext({ "stories/other.json": JSON.stringify({ hello: "world" }) });
    const out = await executeMulmoScriptSave(context, { filePath: "stories/other.json" });
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "File is not a valid MulmoScript" });
  });
});

describe("executeUpdateBeat", () => {
  const seed = () => ({ "stories/x.json": JSON.stringify(VALID_SCRIPT) });

  it("overwrites the addressed beat and persists the script", async () => {
    const { context, store } = makeFakeContext(seed());
    const out = await executeUpdateBeat(context, {
      filePath: "stories/x.json",
      beatIndex: 1,
      beat: { ...VALID_BEAT, text: "Rewritten." },
    });
    assert.deepEqual(out, { ok: true });
    const persisted = JSON.parse(store.get("stories/x.json") as string);
    assert.equal(persisted.beats[1].text, "Rewritten.");
    assert.equal(persisted.beats[0].text, "Beat one.");
  });

  it("rejects an out-of-bounds beatIndex", async () => {
    const { context } = makeFakeContext(seed());
    const out = await executeUpdateBeat(context, { filePath: "stories/x.json", beatIndex: 2, beat: VALID_BEAT });
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "Invalid beatIndex" });
  });

  it("404s a missing script", async () => {
    const { context } = makeFakeContext();
    const out = await executeUpdateBeat(context, { filePath: "stories/nope.json", beatIndex: 0, beat: VALID_BEAT });
    assert.deepEqual(out, { ok: false, code: "not_found", error: "File not found: stories/nope.json" });
  });

  it("propagates body-validation failures", async () => {
    const { context } = makeFakeContext(seed());
    const out = await executeUpdateBeat(context, { filePath: "stories/x.json", beatIndex: 0 });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /beat is required/);
  });
});

describe("executeUpdateScript", () => {
  it("overwrites the whole script", async () => {
    const { context, store } = makeFakeContext({ "stories/x.json": JSON.stringify(VALID_SCRIPT) });
    const next = { ...VALID_SCRIPT, title: "Renamed" };
    const out = await executeUpdateScript(context, { filePath: "stories/x.json", script: next });
    assert.deepEqual(out, { ok: true });
    assert.equal(JSON.parse(store.get("stories/x.json") as string).title, "Renamed");
  });

  it("404s a missing script", async () => {
    const { context } = makeFakeContext();
    const out = await executeUpdateScript(context, { filePath: "stories/nope.json", script: VALID_SCRIPT });
    assert.deepEqual(out, { ok: false, code: "not_found", error: "File not found: stories/nope.json" });
  });

  it("propagates body-validation failures", async () => {
    const { context } = makeFakeContext();
    const out = await executeUpdateScript(context, { filePath: "stories/x.json", script: { bogus: true } });
    assert.equal(out.ok, false);
    if (!out.ok) assert.match(out.error, /invalid script/);
  });
});

describe("executeMulmoScript (ToolResult wrapper)", () => {
  it("returns data + display instructions on success", async () => {
    const { context } = makeFakeContext();
    const result = await executeMulmoScript(context, { script: VALID_SCRIPT });
    assert.ok(result.data);
    assert.equal(result.instructions, "Display the storyboard to the user.");
  });

  it("returns a narrate-only result on failure", async () => {
    const { context } = makeFakeContext();
    const result = await executeMulmoScript(context, {});
    assert.equal(result.data, undefined);
    assert.match(result.message ?? "", /Provide either/);
  });
});

describe("executeMulmoScriptSave — replacing one beat", () => {
  /** A saved script, and the wire path a caller would have been handed for it. */
  async function withSavedScript() {
    const { context, store } = makeFakeContext();
    const saved = await executeMulmoScriptSave(context, { script: VALID_SCRIPT }, NOW);
    assert.equal(saved.ok, true);
    return { context, store, filePath: (saved as { filePath: string }).filePath };
  }

  const beatsIn = (store: Map<string, string>, filePath: string) => {
    const key = [...store.keys()].find((k) => k.endsWith(filePath.replace(/^stories\//, "stories/")));
    return JSON.parse(store.get(key ?? "") ?? "{}").beats as { text?: string }[];
  };

  it("replaces the named beat and leaves the others alone", async () => {
    const { context, store, filePath } = await withSavedScript();
    const before = beatsIn(store, filePath);
    assert.ok(before.length >= 1);

    const out = await executeMulmoScriptSave(context, { filePath, beatIndex: 0, beat: { ...VALID_BEAT, text: "Rewritten." } }, NOW);

    assert.equal(out.ok, true, JSON.stringify(out));
    const after = beatsIn(store, filePath);
    assert.equal(after.length, before.length, "replacing must not add or drop a beat");
    assert.equal(after[0]?.text, "Rewritten.");
  });

  it("answers with the whole script, so the canvas can show the result", async () => {
    const { context, filePath } = await withSavedScript();
    const out = await executeMulmoScriptSave(context, { filePath, beatIndex: 0, beat: { ...VALID_BEAT, text: "Rewritten." } }, NOW);
    assert.equal(out.ok, true);
    // The View is driven by this payload; a bare `{ ok: true }` would leave it showing nothing.
    assert.ok((out as { script?: unknown }).script, "the reply must carry the script");
  });

  it("refuses an index with no replacement, rather than silently displaying the old script", async () => {
    // Reporting nothing here would read as a successful edit that changed nothing.
    const { context, filePath } = await withSavedScript();
    const out = await executeMulmoScriptSave(context, { filePath, beatIndex: 0 }, NOW);
    assert.equal(out.ok, false);
    assert.match((out as { error: string }).error, /go together/);
  });

  it("refuses a replacement with no index", async () => {
    const { context, filePath } = await withSavedScript();
    const out = await executeMulmoScriptSave(context, { filePath, beat: VALID_BEAT }, NOW);
    assert.equal(out.ok, false);
    assert.match((out as { error: string }).error, /go together/);
  });

  it("refuses an index past the end, and writes nothing", async () => {
    const { context, store, filePath } = await withSavedScript();
    const before = JSON.stringify(beatsIn(store, filePath));
    const out = await executeMulmoScriptSave(context, { filePath, beatIndex: 99, beat: VALID_BEAT }, NOW);
    assert.equal(out.ok, false);
    assert.equal(JSON.stringify(beatsIn(store, filePath)), before, "a refused edit must not touch the file");
  });

  it("still re-displays unchanged when neither is given", async () => {
    const { context, store, filePath } = await withSavedScript();
    const before = JSON.stringify(beatsIn(store, filePath));
    const out = await executeMulmoScriptSave(context, { filePath }, NOW);
    assert.equal(out.ok, true);
    assert.equal(JSON.stringify(beatsIn(store, filePath)), before);
  });
});

// ── The absolute `filePath` form ─────────────────────────────────────────────
//
// A relative path must keep resolving through `files.artifacts` under the
// stories dir, byte for byte as before; an absolute one goes to the host's
// `files.byPath` and is its own wire form.

/** `makeFakeContext` plus a second, independent store reached through
 *  `files.byPath` — so a test can prove WHICH FileOps was used, not merely
 *  that the call succeeded. */
function makeByPathContext(
  artifactsSeed: Record<string, string> = {},
  byPathSeed: Record<string, string> = {},
): { context: MulmoScriptExecuteContext; store: Map<string, string>; byPathStore: Map<string, string> } {
  const { context, store } = makeFakeContext(artifactsSeed);
  const byPathStore = new Map(Object.entries(byPathSeed));
  const byPath: FileOps = {
    read: async (rel) => {
      const hit = byPathStore.get(rel);
      if (hit === undefined) throw new Error(`ENOENT: ${rel}`);
      return hit;
    },
    readBytes: async () => new Uint8Array(),
    write: async (rel, content) => {
      byPathStore.set(rel, typeof content === "string" ? content : Buffer.from(content).toString("utf-8"));
    },
    readDir: async () => [],
    stat: async () => ({ mtimeMs: 0, size: 0 }),
    exists: async (rel) => byPathStore.has(rel),
    unlink: async (rel) => {
      byPathStore.delete(rel);
    },
  };
  return { context: { files: { artifacts: context.files.artifacts, byPath } }, store, byPathStore };
}

const ABS = "/Users/me/decks/keynote.json";

describe("executeMulmoScriptSave — absolute filePath", () => {
  it("reads through files.byPath and echoes the absolute path back as the wire form", async () => {
    const { context } = makeByPathContext({}, { [ABS]: JSON.stringify(VALID_SCRIPT) });
    const out = await executeMulmoScriptSave(context, { filePath: ABS }, NOW);
    assert.equal(out.ok, true);
    assert.equal(out.ok && out.filePath, ABS);
  });

  it("never consults files.artifacts for an absolute path", async () => {
    // Same basename seeded in the stories dir. Taking it from there would be
    // the silent substitution every path rule in this package exists to refuse.
    const { context } = makeByPathContext(
      { "stories/keynote.json": JSON.stringify({ ...VALID_SCRIPT, title: "WRONG" }) },
      { [ABS]: JSON.stringify(VALID_SCRIPT) },
    );
    const out = await executeMulmoScriptSave(context, { filePath: ABS }, NOW);
    assert.equal(out.ok && out.script.title, "Test Story");
  });

  it("reports not_found when the absolute path holds nothing", async () => {
    const { context } = makeByPathContext();
    const out = await executeMulmoScriptSave(context, { filePath: ABS }, NOW);
    assert.deepEqual(out, { ok: false, code: "not_found", error: `File not found: ${ABS}` });
  });

  it("is refused by a host that supplies no files.byPath — the pre-existing behaviour", async () => {
    const { context } = makeFakeContext();
    const out = await executeMulmoScriptSave(context, { filePath: ABS }, NOW);
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "Invalid filePath" });
  });

  it("refuses a traversal segment even with files.byPath present", async () => {
    const { context } = makeByPathContext();
    const out = await executeMulmoScriptSave(context, { filePath: "/Users/me/../etc/deck.json" }, NOW);
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "Invalid filePath" });
  });

  it("leaves a RELATIVE filePath on the artifacts FileOps", async () => {
    const { context, byPathStore } = makeByPathContext({ "stories/keynote.json": JSON.stringify(VALID_SCRIPT) });
    const out = await executeMulmoScriptSave(context, { filePath: "stories/keynote.json" }, NOW);
    assert.equal(out.ok && out.filePath, "stories/keynote.json");
    assert.equal(byPathStore.size, 0, "a relative path must never reach files.byPath");
  });
});

describe("update endpoints — absolute filePath", () => {
  it("executeUpdateBeat writes back through files.byPath", async () => {
    const { context, byPathStore, store } = makeByPathContext({}, { [ABS]: JSON.stringify(VALID_SCRIPT) });
    const out = await executeUpdateBeat(context, { filePath: ABS, beatIndex: 0, beat: { ...VALID_BEAT, text: "Edited." } });
    assert.deepEqual(out, { ok: true });
    assert.match(byPathStore.get(ABS) ?? "", /Edited\./);
    assert.equal(store.size, 0, "the edit must not land in the stories dir");
  });

  it("executeUpdateScript writes back through files.byPath", async () => {
    const { context, byPathStore } = makeByPathContext({}, { [ABS]: JSON.stringify(VALID_SCRIPT) });
    const out = await executeUpdateScript(context, { filePath: ABS, script: { ...VALID_SCRIPT, title: "Renamed" } });
    assert.deepEqual(out, { ok: true });
    assert.match(byPathStore.get(ABS) ?? "", /"Renamed"/);
  });

  it("executeUpdateBeat on an absolute path is refused without files.byPath", async () => {
    const { context } = makeFakeContext();
    const out = await executeUpdateBeat(context, { filePath: ABS, beatIndex: 0, beat: VALID_BEAT });
    assert.deepEqual(out, { ok: false, code: "bad_request", error: "Invalid filePath" });
  });
});
