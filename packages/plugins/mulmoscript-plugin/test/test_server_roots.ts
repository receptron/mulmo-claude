// The ops layer's half of #3014: a `root` that reaches the registry, the
// tracker and the published events.
//
// These exist because the first cut of #3015 widened the KEY functions and
// left the data behind — `root` was a parameter nobody passed, so the wire
// field existed and the collisions it was meant to end were all still there.
// Type-checking cannot catch that: `root` is optional, so a forgotten forward
// is a legal call. Only a test that asserts on the OUTPUT can.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { FileOps } from "gui-chat-protocol";
import { createMulmoScriptServerOps } from "../src/server/ops";
import type { MulmoScriptGenerationEvent, MulmoScriptChangedEvent } from "../src/core/contract";

const stubFileOps: FileOps = {
  read: async () => {
    throw new Error("unused");
  },
  readBytes: async () => new Uint8Array(),
  write: async () => {},
  readDir: async () => [],
  stat: async () => ({ mtimeMs: 0, size: 0 }),
  exists: async () => false,
  unlink: async () => {},
};

function makeOps(extraRoots?: Record<string, string>) {
  const generations: MulmoScriptGenerationEvent[] = [];
  const changes: MulmoScriptChangedEvent[] = [];
  const ops = createMulmoScriptServerOps({
    storiesDir: "/nonexistent/for-tests/artifacts/stories",
    ...(extraRoots ? { extraRoots } : {}),
    artifacts: stubFileOps,
    writeFileAtomic: async () => {},
    onGenerationEvent: (_session, event) => generations.push(event),
    onScriptChanged: (event) => changes.push(event),
  });
  return { ops, generations, changes };
}

describe("root registry", () => {
  it("rejects an unregistered root rather than falling back to the default", () => {
    const { ops } = makeOps();
    const result = ops.resolveStory("stories/deck.json", "nope");
    assert.equal(result.ok, false);
    // A fallback would resolve a DIFFERENT file that happens to share the name.
    assert.equal(result.ok === false && result.code, "bad_request");
  });

  it("normalizes a root id by trimming, matching readCommandScope", () => {
    // Two parallel "which project root" identifiers must agree on what one
    // root is, or the same string names different roots in different layers.
    const { ops } = makeOps({ repoA: "/tmp/a" });
    assert.equal(ops.guardStoryWriteRoot("  "), null, "whitespace is the default root, not a named one");
    assert.equal(ops.toStoryRef("/tmp/a/x.json", " repoA "), ops.toStoryRef("/tmp/a/x.json", "repoA"));
  });

  it("refuses a whitespace-only extraRoots id at construction", () => {
    assert.throws(() => makeOps({ "   ": "/somewhere" }), /must not be empty/);
  });

  it("refuses an empty extraRoots id at construction", () => {
    // The empty id is the default root's own key; accepting it would re-point
    // every pre-roots caller. Boot is the cheap place to fail.
    assert.throws(() => makeOps({ "": "/somewhere" }), /must not be empty/);
  });

  it("does not create an extra root's directory as a side effect", () => {
    // "Put the deck in the repository" must not grow `artifacts/stories/`
    // inside the user's worktree because something polled a status.
    const tmp = mkdtempSync(path.join(tmpdir(), "mulmoscript-roots-"));
    const missing = path.join(tmp, "not-created");
    try {
      const { ops } = makeOps({ repo: missing });
      ops.resolveStory("stories/deck.json", "repo");
      assert.equal(ops.toStoryRef("/anything", "repo"), null, "an unrealizable root has no wire ref");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("gives an unregistered root no wire ref instead of the default root's", () => {
    const { ops } = makeOps();
    assert.equal(ops.toStoryRef("/nonexistent/for-tests/artifacts/stories/a.json", "nope"), null);
  });
});

describe("generation events carry their root", () => {
  it("puts the root on the published event", () => {
    const { ops, generations } = makeOps({ repoA: "/tmp/a" });
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false, { root: "repoA" });
    assert.equal(generations.length, 1);
    assert.equal(generations[0]?.root, "repoA");
  });

  it("omits the root for the default one, so pre-#3014 consumers see no change", () => {
    const { ops, generations } = makeOps();
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false);
    assert.equal(generations.length, 1);
    assert.ok(!("root" in generations[0]!), "default root must not appear on the wire");
  });
});

describe("a start event carries its root and no error", () => {
  // The shape of `publishGeneration` used to end in two adjacent optional
  // strings, `error` then `root`. Appending `root` to the call sites that pass
  // no error put it in `error`'s slot: the start event announced
  // `error: "repoA"`, the root was dropped, the tracker entry was filed under
  // the default root, and — because the matching finish passed both — its key
  // differed and the entry was never deleted. One leaked row per generation,
  // for the life of the process (#3015 review).
  it("does not report an error when a generation starts in a named root", () => {
    const { ops, generations } = makeOps({ repoA: "/tmp/a" });
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false, { root: "repoA" });
    const started = generations[0]!;
    assert.equal(started.done, false);
    assert.equal(started.root, "repoA");
    assert.ok(!("error" in started), `a start must carry no error, got ${JSON.stringify(started)}`);
  });

  it("clears the tracker when the matching finish arrives", () => {
    // Start and finish must produce the SAME key. When they did not, the
    // snapshot kept reporting a finished run forever.
    const { ops } = makeOps({ repoA: "/tmp/a" });
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false, { root: "repoA" });
    assert.equal(ops.pendingGenerations("stories/deck.json", "repoA").length, 1);
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", true, { root: "repoA" });
    assert.equal(ops.pendingGenerations("stories/deck.json", "repoA").length, 0, "the finish must delete the entry it started");
  });
});

describe("pendingGenerations is scoped by the pair", () => {
  it("does not hand one root's in-flight run to another root's View", () => {
    const { ops } = makeOps({ repoA: "/tmp/a", repoB: "/tmp/b" });
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false, { root: "repoA" });

    assert.equal(ops.pendingGenerations("stories/deck.json", "repoA").length, 1);
    assert.equal(ops.pendingGenerations("stories/deck.json", "repoB").length, 0, "repoB must not see repoA's run");
    assert.equal(ops.pendingGenerations("stories/deck.json").length, 0, "the default root must not see it either");
  });

  it("keeps the default root's snapshot exactly as it was", () => {
    const { ops } = makeOps();
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false);
    const pending = ops.pendingGenerations("stories/deck.json");
    assert.equal(pending.length, 1);
    assert.ok(!("root" in pending[0]!));
  });

  it("dedups per root — the same deck in two roots is two runs", () => {
    const { ops, generations } = makeOps({ repoA: "/tmp/a", repoB: "/tmp/b" });
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false, { root: "repoA" });
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false, { root: "repoB" });
    // Two starts, not one start plus a suppressed duplicate.
    assert.equal(generations.filter((e) => !e.done).length, 2);
  });
});

describe("every read resolves in the root it was asked for", () => {
  // `runStoryOp` forwards the root for the ops that go through it, but the
  // movie and PDF generators call `resolveStory` DIRECTLY — a call site the
  // first round's "count the forwards" check missed because it only counted
  // `runStoryOp` options (CodeRabbit on #3015). An unregistered root must
  // therefore fail HERE too, not silently resolve in the default root.
  const unregistered = "nope";

  it("fails generateMovie for an unregistered root instead of using the default", async () => {
    const { ops } = makeOps({ repoA: "/tmp/a" });
    const result = await ops.generateMovieOp("stories/deck.json", undefined, unregistered);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "bad_request");
  });

  it("fails generatePdf for an unregistered root instead of using the default", async () => {
    const { ops } = makeOps({ repoA: "/tmp/a" });
    const result = await ops.generatePdfOp("stories/deck.json", undefined, unregistered);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "bad_request");
  });
});

describe("writes stay in the default root until step 2", () => {
  // Reads became root-aware in this PR; writes did not. `executeMulmoScriptSave`
  // and the update executors run against one FileOps bound to the default root,
  // so a write naming another root would rewrite the DEFAULT root's
  // identically-named file and then announce the other one as changed
  // (#3015 review G1). Fail closed until step 2 supplies a per-root FileOps.
  it("refuses a write that names a non-default root", () => {
    const { ops } = makeOps({ repoA: "/tmp/a" });
    const guard = ops.guardStoryWriteRoot("repoA");
    assert.ok(guard, "a named root must not be writable yet");
    assert.equal(guard?.code, "bad_request");
  });

  it("still allows every write that names no root", () => {
    const { ops } = makeOps({ repoA: "/tmp/a" });
    assert.equal(ops.guardStoryWriteRoot(undefined), null);
    assert.equal(ops.guardStoryWriteRoot(""), null, "the empty spelling is the default root");
  });
});

describe("script-changed events carry their root", () => {
  it("names the root a write happened in", () => {
    const { ops, changes } = makeOps({ repoA: "/tmp/a" });
    ops.publishScriptChanged("stories/deck.json", "view-1", "repoA");
    assert.equal(changes[0]?.root, "repoA");
  });

  it("omits it for the default root", () => {
    const { ops, changes } = makeOps();
    ops.publishScriptChanged("stories/deck.json", "view-1");
    assert.ok(!("root" in changes[0]!));
  });
});
