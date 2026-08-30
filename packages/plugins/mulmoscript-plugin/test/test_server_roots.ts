// The ops layer's half of #3014: a `root` that reaches the registry, the
// tracker and the published events.
//
// These exist because the first cut of #3015 widened the KEY functions and
// left the data behind — `root` was a parameter nobody passed, so the wire
// field existed and the collisions it was meant to end were all still there.
// Type-checking cannot catch that: `root` is optional, so a forgotten forward
// is a legal call. Only a test that asserts on the OUTPUT can.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { FileOps } from "gui-chat-protocol";
import { createMulmoScriptServerOps } from "../src/server/ops";
import type { OpResult } from "../src/server/types";
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

  it("warns at boot that named roots are read-only until the protocol carries the root", () => {
    // The pair identity stops at the host boundary: `generationKey` in
    // `@mulmobridge/protocol` keys on `(kind, filePath, key)`. Widening it is a
    // protocol change with its own consumers, so this package cannot make it —
    // but it can make sure the first host to register a root is told, at boot,
    // instead of finding out from a stuck spinner (Codex P1 on #3015).
    const warnings: string[] = [];
    createMulmoScriptServerOps({
      storiesDir: "/nonexistent/for-tests/artifacts/stories",
      extraRoots: { repoA: "/tmp/a" },
      artifacts: stubFileOps,
      writeFileAtomic: async () => {},
      log: { info: () => {}, warn: (message) => warnings.push(message), error: () => {} },
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /generation and writes are REFUSED in them/);
  });

  it("says nothing at boot when only the default root is registered", () => {
    const warnings: string[] = [];
    createMulmoScriptServerOps({
      storiesDir: "/nonexistent/for-tests/artifacts/stories",
      artifacts: stubFileOps,
      writeFileAtomic: async () => {},
      log: { info: () => {}, warn: (message) => warnings.push(message), error: () => {} },
    });
    assert.equal(warnings.length, 0, "the single-root world must stay silent");
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

  it("matches a start and finish written with different spellings of one root", () => {
    // The tracker value and the event normalize; the KEY did not, so
    // `" repoA "` started an entry that `"repoA"` could never delete
    // (Codex P2 on #3015).
    const { ops } = makeOps({ repoA: "/tmp/a" });
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", false, { root: " repoA " });
    assert.equal(ops.pendingGenerations("stories/deck.json", "repoA").length, 1);
    ops.publishGeneration(undefined, "movie", "stories/deck.json", "", true, { root: "repoA" });
    assert.equal(ops.pendingGenerations("stories/deck.json", "repoA").length, 0, "the finish must delete the entry the untrimmed start created");
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

describe("the whole ops surface is classified for named roots", () => {
  // The per-site guard was a list, and a list is something someone has to
  // remember to extend: `save` / `updateBeat` / `updateScript` were guarded
  // while the two upload kinds were not, so an image could still be written
  // into a named root (CodeRabbit on #3015). That is the fifth finding of the
  // same shape on this PR — a rule enforced by enumerating its sites.
  //
  // So the enumeration moves here, where being incomplete is a RED TEST rather
  // than a hole: every key the ops object exposes must appear below. A new op
  // added without classifying it fails `every op is classified`, and one
  // classified as mutating must actually refuse.
  const namedRoot = "repoA";
  /**
   * Which members must be classified, read off the source rather than listed.
   *
   * The first version of this test had a hand-written "not an op" exclusion
   * set, and `triggerAutoBackgroundMovie` sat in it — a member that takes a
   * `root` and starts a full generation, exempted by the very list meant to
   * catch it (Codex P1 on #3015). A hand-maintained exemption list is the same
   * failure as a hand-maintained guard list, one level up.
   *
   * So the rule is derived: a member whose declaration accepts a `root` is a
   * root-aware entry point and must be classified. Adding one and forgetting
   * turns this red without anyone editing an exemption.
   */
  function rootAwareMembers(): string[] {
    const source = readFileSync(new URL("../src/server/ops.ts", import.meta.url), "utf8");
    const returned = /\n {2}return \{\n([\s\S]*?)\n {2}\};/.exec(source);
    assert.ok(returned, "could not find the ops object literal in ops.ts");
    const keys = returned[1]!
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((key) => /^[A-Za-z][A-Za-z0-9]*$/.test(key));
    assert.ok(keys.length > 10, "the ops object literal parsed to too few keys — the regex has drifted");
    return keys.filter((key) => {
      const decl = new RegExp(`function ${key}\\(([^)]*)\\)`).exec(source);
      // `root?: string` directly, or an args object that carries one
      // (`GenerateOpArgsWith<…>`) — the second form is how `renderBeatOp` and
      // its siblings take theirs, and a check that saw only the first would
      // exempt every generation op it exists to police.
      return decl !== null && /\broot\??:|GenerateOpArgs|StoryOpOptions/.test(decl[1]!);
    });
  }

  /** Ops that only read. A named root is legal for them — that is the feature. */
  const READ_ONLY = ["beatImageOp", "beatAudioOp", "beatMovieOp", "characterImageOp", "movieStatusOp", "pdfStatusOp"] as const;
  /**
   * Root-aware members that are not `OpResult` ops, so the generic invoker
   * below cannot drive them — each has its own test in this file instead.
   * They still have to be named, because being unnamed is what let
   * `triggerAutoBackgroundMovie` through.
   */
  const GUARDED_ELSEWHERE = [
    "toStoryRef",
    "resolveStory",
    "guardStoryWirePath",
    "guardStoryWriteRoot",
    "guardStoryGenerationRoot",
    "runStoryOp",
    "publishGeneration",
    "publishScriptChanged",
    "pendingGenerations",
    "triggerAutoBackgroundMovie",
  ] as const;
  /** Ops that write or generate. A named root must be refused, fail-closed. */
  const REFUSAL = /^(writing to|generating in) a non-default stories root is not supported yet$/;
  const MUTATING: ReadonlyArray<[string, (ops: ReturnType<typeof makeOps>["ops"]) => Promise<OpResult<unknown>>]> = [
    ["renderBeatOp", (ops) => ops.renderBeatOp({ filePath: "stories/d.json", beatIndex: 0, root: namedRoot })],
    ["generateBeatAudioOp", (ops) => ops.generateBeatAudioOp({ filePath: "stories/d.json", beatIndex: 0, root: namedRoot })],
    ["renderCharacterOp", (ops) => ops.renderCharacterOp({ filePath: "stories/d.json", key: "alice", root: namedRoot })],
    ["uploadBeatImageOp", (ops) => ops.uploadBeatImageOp("stories/d.json", 0, "data:image/png;base64,AA==", namedRoot)],
    ["uploadCharacterImageOp", (ops) => ops.uploadCharacterImageOp("stories/d.json", "alice", "data:image/png;base64,AA==", namedRoot)],
    ["generateMovieOp", (ops) => ops.generateMovieOp("stories/d.json", undefined, namedRoot)],
    ["generatePdfOp", (ops) => ops.generatePdfOp("stories/d.json", undefined, namedRoot)],
  ];

  it("the derivation actually finds the root-aware members", () => {
    // Without this the classification test passes vacuously the moment the
    // regex stops matching — a silent green is the failure mode of every
    // check that reads source.
    const found = rootAwareMembers();
    assert.ok(found.length >= 19, `expected the ops surface to expose many root-aware members, found ${found.length}`);
    for (const expected of ["triggerAutoBackgroundMovie", "renderBeatOp", "uploadBeatImageOp", "beatImageOp"]) {
      assert.ok(found.includes(expected), `${expected} takes a root but the derivation missed it`);
    }
  });

  it("every root-aware member is classified as read-only or mutating", () => {
    const classified = new Set<string>([...READ_ONLY, ...MUTATING.map(([name]) => name), ...GUARDED_ELSEWHERE]);
    const unclassified = rootAwareMembers().filter((key) => !classified.has(key));
    assert.deepEqual(unclassified, [], `classify these in test_server_roots.ts: ${unclassified.join(", ")}`);
  });

  it("the classification names members that actually exist", () => {
    // The derivation reads source; this pins it to the real object, so a
    // renamed op cannot leave a classification pointing at nothing.
    const { ops } = makeOps({ [namedRoot]: "/tmp/a" });
    const missing = [...READ_ONLY, ...MUTATING.map(([name]) => name), ...GUARDED_ELSEWHERE].filter((name) => !(name in ops));
    assert.deepEqual(missing, []);
  });

  for (const [name, invoke] of MUTATING) {
    it(`${name} refuses a named root`, async () => {
      const { ops, generations } = makeOps({ [namedRoot]: "/tmp/a" });
      const result = await invoke(ops);
      // The REASON, not just `ok === false`. Every one of these also fails for
      // an unrelated reason in this fixture (no such script on disk), so
      // asserting failure alone stays green with the guard deleted — which is
      // exactly what removing it proved before this line was tightened.
      assert.equal(result.ok, false, `${name} must refuse a named root`);
      assert.equal(result.ok === false && result.code, "bad_request", `${name} must refuse with bad_request`);
      assert.match(result.ok === false ? result.error : "", REFUSAL, `${name} must refuse BECAUSE of the root`);
      // Refused BEFORE any announcement: a start with no matching finish is
      // the stuck indicator these guards exist to prevent.
      assert.equal(generations.length, 0, `${name} must not publish anything when refused`);
    });
  }
});

describe("the detached background movie is refused in a named root too", () => {
  // It returns `void`, so it can carry no `OpResult` — and that is exactly why
  // it was the one generation the guard missed. A detached run corrupting the
  // other root's pending state has no caller to see the failure.
  const namedRoot = "repoA";

  it("starts nothing and publishes nothing for a named root", () => {
    const { ops, generations } = makeOps({ [namedRoot]: "/tmp/a" });
    ops.triggerAutoBackgroundMovie("/tmp/a/stories/d.json", "stories/d.json", "session-1", namedRoot);
    assert.equal(generations.length, 0, "a refused background movie must announce nothing");
    assert.equal(ops.inFlightMovies.has("/tmp/a/stories/d.json"), false, "a refused background movie must not be marked in flight");
  });

  it("still starts for the default root", () => {
    const { ops } = makeOps({ [namedRoot]: "/tmp/a" });
    ops.triggerAutoBackgroundMovie("/tmp/x/stories/d.json", "stories/d.json", "session-1");
    assert.equal(ops.inFlightMovies.has("/tmp/x/stories/d.json"), true, "the default root must still generate");
  });
});

describe("generations stay in the default root until step 2", () => {
  // The host's per-session store keys pending work by `(kind, filePath, key)`
  // — `generationKey` in `@mulmobridge/protocol`. Two roots running the same
  // generation in one session would collapse to one entry, and either
  // completion would clear the other root's indicator. Widening that key is a
  // protocol change with its own consumers, so the generation is refused
  // instead: a run that cannot be tracked correctly must not start
  // (Codex P1 on #3015).
  const namedRoot = "repoA";

  it("refuses every generation kind in a named root", async () => {
    const { ops } = makeOps({ [namedRoot]: "/tmp/a" });
    const results = [
      await ops.generateMovieOp("stories/deck.json", "session-1", namedRoot),
      await ops.generatePdfOp("stories/deck.json", "session-1", namedRoot),
      await ops.renderBeatOp({ filePath: "stories/deck.json", beatIndex: 0, chatSessionId: "session-1", root: namedRoot }),
      await ops.generateBeatAudioOp({ filePath: "stories/deck.json", beatIndex: 0, chatSessionId: "session-1", root: namedRoot }),
      await ops.renderCharacterOp({ filePath: "stories/deck.json", key: "alice", chatSessionId: "session-1", root: namedRoot }),
    ];
    for (const result of results) {
      assert.equal(result.ok, false);
      assert.equal(result.ok === false && result.code, "bad_request");
    }
  });

  it("publishes nothing for a refused generation", () => {
    // The refusal must come BEFORE the start event: a start with no matching
    // finish is the stuck-spinner this guard exists to prevent.
    const { ops, generations } = makeOps({ [namedRoot]: "/tmp/a" });
    void ops.generateMovieOp("stories/deck.json", "session-1", namedRoot);
    assert.equal(generations.length, 0);
  });

  it("still allows generation that names no root", async () => {
    const { ops } = makeOps({ [namedRoot]: "/tmp/a" });
    const result = await ops.generateMovieOp("stories/deck.json", "session-1");
    // It fails for an unrelated reason (no such script), but NOT with the
    // root refusal — the default root is still generatable.
    assert.ok(result.ok === false && result.error !== "generating in a non-default stories root is not supported yet");
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

describe("one root, one cache entry, whatever the spelling", () => {
  // `ensureStoriesReal` memoises the realpath forever — the directory's real
  // path is stable once it exists, so nothing evicts it. Keyed by the raw root
  // id, `" repoA "` and `"repoA"` both resolved (the LOOKUP normalises) and
  // then cached separately, so a never-evicted map grew one entry per spelling
  // (Codex P2 on #3015). It is keyed by the resolved DIRECTORY now, which
  // leaves no normalisation for a caller to forget.
  //
  // The root is registered THROUGH A SYMLINK so its configured path and its
  // realpath differ on every platform. A first version leaned on macOS
  // resolving the temp dir through `/var` → `/private/var`, which made the
  // discrimination real there and vacuous on Linux — where the two are the
  // same string, a cold cache and a warm one produce identical output and the
  // test passed while proving nothing. It failed on ubuntu in CI.
  const workspaces: string[] = [];
  after(() => workspaces.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** Non-null unless this platform refuses to create the symlink. */
  function makeSymlinkedRoot(): { ops: ReturnType<typeof createMulmoScriptServerOps>; realStories: string; realTree: string } | null {
    const workspace = mkdtempSync(path.join(tmpdir(), "mulmoscript-rootcache-"));
    workspaces.push(workspace);
    const realTree = path.join(workspace, "real");
    const realStoriesDir = path.join(realTree, "artifacts", "stories");
    mkdirSync(realStoriesDir, { recursive: true });
    writeFileSync(path.join(realStoriesDir, "foo.json"), "{}");
    const link = path.join(workspace, "link");
    try {
      symlinkSync(realTree, link, "junction");
    } catch {
      return null;
    }
    const ops = createMulmoScriptServerOps({
      storiesDir: path.join(workspace, "default", "artifacts", "stories"),
      extraRoots: { repoA: path.join(link, "artifacts", "stories") },
      artifacts: stubFileOps,
      writeFileAtomic: async () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    return { ops, realStories: realpathSync(realStoriesDir), realTree };
  }

  it("resolves every spelling of one root to the same file", () => {
    const fixture = makeSymlinkedRoot();
    if (!fixture) return;
    const canonical = fixture.ops.resolveStory("stories/foo.json", "repoA");
    assert.ok(canonical.ok);
    for (const spelling of [" repoA ", "repoA  ", "  repoA"]) {
      const resolved = fixture.ops.resolveStory("stories/foo.json", spelling);
      assert.ok(resolved.ok, `expected ${JSON.stringify(spelling)} to resolve`);
      assert.equal(resolved.absolutePath, canonical.absolutePath);
    }
  });

  it("shares the memoised realpath across spellings", () => {
    // The only externally visible difference between one cache entry and two:
    // once the directory is gone, a SHARED entry still answers from memory,
    // while a second spelling with its own key would re-realpath a missing
    // directory and fall back to the SYMLINK path, which the real file is not
    // under. Deleting the directory is what makes the cache observable.
    const fixture = makeSymlinkedRoot();
    if (!fixture) return;
    assert.ok(fixture.ops.resolveStory("stories/foo.json", "repoA").ok, "warm the cache under one spelling");
    rmSync(fixture.realTree, { recursive: true, force: true });
    assert.equal(
      fixture.ops.toStoryRef(path.join(fixture.realStories, "foo.json"), " repoA "),
      "stories/foo.json",
      "a second spelling must hit the entry the first one filled",
    );
  });

  it("returns null for a cold cache once the directory is gone", () => {
    // Without this the test above means nothing: it has to be possible to
    // fail. Nothing memoised, the directory gone, so the base falls back to
    // the symlink path and the ref comes out traversal-shaped.
    const fixture = makeSymlinkedRoot();
    if (!fixture) return;
    rmSync(fixture.realTree, { recursive: true, force: true });
    assert.equal(fixture.ops.toStoryRef(path.join(fixture.realStories, "foo.json"), "repoA"), null);
  });
});
