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
import { storyRefWithin } from "../src/core/paths";
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

  it("tells a host that registers a root exactly what does not work yet", () => {
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
    assert.match(warnings[0]!, /GENERATION is refused until this host declares `rootScopedGenerationState`/);
  });

  it("refuses two extraRoots ids that trim to the same key", () => {
    // `set` would keep the LAST directory, so every read for `repoA` would
    // answer from a directory the card never named — with the host given no
    // signal at all (CodeRabbit on #3015). A misconfiguration is cheapest to
    // fail on at boot, and silently resolving the wrong directory is exactly
    // what this package refuses everywhere else.
    assert.throws(
      () =>
        createMulmoScriptServerOps({
          storiesDir: "/nonexistent/for-tests/artifacts/stories",
          extraRoots: { repoA: "/tmp/a", " repoA ": "/tmp/b" },
          artifacts: stubFileOps,
          writeFileAtomic: async () => {},
          log: { info: () => {}, warn: () => {}, error: () => {} },
        }),
      /registered twice/,
    );
  });

  it("still accepts two distinct roots pointing at different directories", () => {
    // The throw must be about the KEY, not about having more than one root.
    assert.doesNotThrow(() =>
      createMulmoScriptServerOps({
        storiesDir: "/nonexistent/for-tests/artifacts/stories",
        extraRoots: { repoA: "/tmp/a", repoB: "/tmp/b" },
        artifacts: stubFileOps,
        writeFileAtomic: async () => {},
        log: { info: () => {}, warn: () => {}, error: () => {} },
      }),
    );
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
    // Uploads write through `resolveStory`'s per-root containment and take the
    // absolute path it returns, so a named root is already the RIGHT place to
    // write — they have their own coverage below rather than a refusal (#3019).
    "uploadBeatImageOp",
    "uploadCharacterImageOp",
    "toStoryRef",
    "resolveStory",
    "guardStoryWirePath",
    "guardStoryRootRegistered",
    "guardStoryWriteRoot",
    // Not an op: the resolver the write guard and dispatch consult. Covered by
    // the per-root write cases below.
    "artifactsForRoot",
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

  it("publishes nothing for a refused generation", async () => {
    // The refusal must come BEFORE the start event: a start with no matching
    // finish is the stuck-spinner this guard exists to prevent.
    //
    // Awaited, not fired and forgotten: on the same tick `generations` is
    // empty whether the guard ran or the op merely had not reached its
    // publish yet, so the un-awaited version stayed green for the wrong
    // reason (CodeRabbit on #3015).
    const { ops, generations } = makeOps({ [namedRoot]: "/tmp/a" });
    await ops.generateMovieOp("stories/deck.json", "session-1", namedRoot);
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
  interface SymlinkedTree {
    realTree: string;
    realStoriesDir: string;
    linkedStoriesDir: string;
    defaultStoriesDir: string;
  }

  /** `null` when the platform refuses the symlink; the caller reports a skip. */
  function makeSymlinkedTree(): SymlinkedTree | null {
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
    return {
      realTree,
      realStoriesDir,
      linkedStoriesDir: path.join(link, "artifacts", "stories"),
      defaultStoriesDir: path.join(workspace, "default", "artifacts", "stories"),
    };
  }

  function makeSymlinkedRoot(): { ops: ReturnType<typeof createMulmoScriptServerOps>; realStories: string; realTree: string } | null {
    const tree = makeSymlinkedTree();
    if (!tree) return null;
    const ops = createMulmoScriptServerOps({
      storiesDir: tree.defaultStoriesDir,
      extraRoots: { repoA: tree.linkedStoriesDir },
      artifacts: stubFileOps,
      writeFileAtomic: async () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    return { ops, realStories: realpathSync(tree.realStoriesDir), realTree: tree.realTree };
  }

  it("resolves every spelling of one root to the same file", (t) => {
    const fixture = makeSymlinkedRoot();
    // Reported rather than returned: a silent early return is a green test
    // that exercised nothing, which is the shape this file argues against.
    if (!fixture) return t.skip("this platform refuses to create the symlink");
    const canonical = fixture.ops.resolveStory("stories/foo.json", "repoA");
    assert.ok(canonical.ok);
    for (const spelling of [" repoA ", "repoA  ", "  repoA"]) {
      const resolved = fixture.ops.resolveStory("stories/foo.json", spelling);
      assert.ok(resolved.ok, `expected ${JSON.stringify(spelling)} to resolve`);
      assert.equal(resolved.absolutePath, canonical.absolutePath);
    }
  });

  it("shares the memoised realpath across spellings", (t) => {
    // The only externally visible difference between one cache entry and two:
    // once the directory is gone, a SHARED entry still answers from memory,
    // while a second spelling with its own key would re-realpath a missing
    // directory and fall back to the SYMLINK path, which the real file is not
    // under. Deleting the directory is what makes the cache observable.
    const fixture = makeSymlinkedRoot();
    // Reported rather than returned: a silent early return is a green test
    // that exercised nothing, which is the shape this file argues against.
    if (!fixture) return t.skip("this platform refuses to create the symlink");
    assert.ok(fixture.ops.resolveStory("stories/foo.json", "repoA").ok, "warm the cache under one spelling");
    rmSync(fixture.realTree, { recursive: true, force: true });
    assert.equal(
      fixture.ops.toStoryRef(path.join(fixture.realStories, "foo.json"), " repoA "),
      "stories/foo.json",
      "a second spelling must hit the entry the first one filled",
    );
  });

  it("returns null for a cold cache once the directory is gone", (t) => {
    // Without this the test above means nothing: it has to be possible to
    // fail. Nothing memoised, the directory gone, so the base falls back to
    // the symlink path and the ref comes out traversal-shaped.
    const fixture = makeSymlinkedRoot();
    // Reported rather than returned: a silent early return is a green test
    // that exercised nothing, which is the shape this file argues against.
    if (!fixture) return t.skip("this platform refuses to create the symlink");
    rmSync(fixture.realTree, { recursive: true, force: true });
    assert.equal(fixture.ops.toStoryRef(path.join(fixture.realStories, "foo.json"), "repoA"), null);
  });
});

describe("a path that has no relative route to the root gets no wire ref", () => {
  // Windows-only in the wild, but pinned so every platform runs it.
  //
  // `path.relative` says "not under the base" in two ways, and only one looks
  // like an escape. `../…` is the familiar one. Across DRIVES there is no
  // relative path at all, so `path.relative("C:\\base", "D:\\x")` answers
  // `"D:\\x"` — absolute, with no `..` for the escape check to catch. It
  // minted `stories/D:/anything`: a wire ref that reads back as a different
  // file, which is the exact substitution `toStoryRef` exists to refuse. Only
  // Windows CI caught it; macOS and Linux have one root and always find a
  // relative route (#3015 post-merge).
  const workspaces: string[] = [];
  after(() => workspaces.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("refuses a target with no relative route, whatever the platform calls it", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "mulmoscript-noroute-"));
    workspaces.push(workspace);
    const storiesDir = path.join(workspace, "artifacts", "stories");
    mkdirSync(storiesDir, { recursive: true });
    const { ops } = { ops: createMulmoScriptServerOps({ storiesDir, artifacts: stubFileOps, writeFileAtomic: async () => {} }) };

    // On Windows the second drive has no relative route; on POSIX the same
    // string is an ordinary escape. Either way the answer must be null, and
    // the ref must never carry the target verbatim.
    for (const outside of ["D:\\anything", "/anything", path.join(workspace, "..", "elsewhere", "deck.json")]) {
      const ref = ops.toStoryRef(outside, undefined);
      assert.ok(ref === null || !ref.includes(".."), `${outside} must not mint a traversal ref, got ${ref}`);
      assert.ok(ref === null || !path.isAbsolute(ref.replace(/^stories\//, "")), `${outside} must not mint an absolute ref, got ${ref}`);
    }
  });

  it("still names a file that IS under the root", () => {
    // Without this the test above passes by refusing everything.
    const workspace = mkdtempSync(path.join(tmpdir(), "mulmoscript-noroute-ok-"));
    workspaces.push(workspace);
    const storiesDir = path.join(workspace, "artifacts", "stories");
    mkdirSync(storiesDir, { recursive: true });
    const ops = createMulmoScriptServerOps({ storiesDir, artifacts: stubFileOps, writeFileAtomic: async () => {} });
    assert.equal(ops.toStoryRef(path.join(realpathSync(storiesDir), "deck.json"), undefined), "stories/deck.json");
  });
});

describe("storyRefWithin — the Windows case, driven from any platform", () => {
  // The bug: `path.relative` says "not under the base" in TWO ways, and only
  // one looks like an escape. `../…` is familiar. Across Windows DRIVES there
  // is no relative path at all, so `relative("C:\\base", "D:\\x")` answers
  // `"D:\\x"` — absolute, no `..` for the escape check to catch. That minted
  // `stories/D:/anything`: a wire ref reading back as a DIFFERENT file, the
  // exact substitution this rule exists to refuse. Only Windows CI caught it.
  //
  // The rule takes its path module as an argument precisely so the case is
  // reachable here — on macOS and Linux there is one root and always a
  // relative route, so a test using the real `path` proves nothing.
  const WIN_ROOT = "C:\\workspace\\artifacts\\stories";

  it("refuses a target on another drive", () => {
    assert.equal(storyRefWithin(WIN_ROOT, "D:\\anything", path.win32), null);
    assert.equal(storyRefWithin(WIN_ROOT, "D:\\repo\\artifacts\\stories\\deck.json", path.win32), null);
  });

  it("refuses an ordinary escape on the same drive", () => {
    assert.equal(storyRefWithin(WIN_ROOT, "C:\\elsewhere\\deck.json", path.win32), null);
  });

  it("still names a file inside the root, with forward slashes on the wire", () => {
    // The other half: the drive check must not reject legitimate refs, and the
    // wire form stays POSIX whatever the host separator is.
    assert.equal(storyRefWithin(WIN_ROOT, "C:\\workspace\\artifacts\\stories\\deck.json", path.win32), "stories/deck.json");
    assert.equal(storyRefWithin(WIN_ROOT, "C:\\workspace\\artifacts\\stories\\sub\\deck.json", path.win32), "stories/sub/deck.json");
    assert.equal(storyRefWithin(WIN_ROOT, WIN_ROOT, path.win32), "stories");
  });

  it("keeps the POSIX rules intact", () => {
    const root = "/workspace/artifacts/stories";
    assert.equal(storyRefWithin(root, "/workspace/artifacts/stories/deck.json", path.posix), "stories/deck.json");
    assert.equal(storyRefWithin(root, "/elsewhere/deck.json", path.posix), null);
    assert.equal(storyRefWithin(root, root, path.posix), "stories");
  });
});

describe("an upload writes into the root it names — and nowhere else", () => {
  // The guard that refused these was defensive, not necessary: `runStoryOp`
  // resolves through `resolveStory` (realpath containment, per root) and hands
  // the executor an ABSOLUTE path. Removing a guard is only safe if what it
  // was standing in front of is actually sound, so this drives the real
  // filesystem rather than asserting the guard is gone (#3019).
  //
  // Containment rests on `resolveStory` ALONE here: both hosts inject a
  // `writeFileAtomic` that trusts the absolute path it is handed
  // (MulmoTerminal `server/backends/mulmoscript.ts:66` mkdir -p's and renames).
  // That is the invariant these cases exist to hold.
  const workspaces: string[] = [];
  after(() => workspaces.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  function makeTwoRoots() {
    const base = mkdtempSync(path.join(tmpdir(), "mulmoscript-upload-"));
    workspaces.push(base);
    const written: string[] = [];
    const roots = { repoA: path.join(base, "a"), repoB: path.join(base, "b") };
    const defaultStories = path.join(base, "ws", "artifacts", "stories");
    for (const dir of [roots.repoA, roots.repoB, defaultStories]) mkdirSync(dir, { recursive: true });
    // The same wire path exists in all three — the case the pair identity is
    // for. A REAL script, because the upload path builds a mulmocast context
    // from the file before it derives the image path: a `{}` stub fails long
    // before the write, and the assertion below would pass on a run that never
    // wrote anything.
    const deck = JSON.stringify({
      $mulmocast: { version: "1.1" },
      title: "Deck",
      lang: "en",
      beats: [{ speaker: "Narrator", text: "Beat one.", image: { type: "textSlide", slide: { title: "S", bullets: ["b"] } } }],
      imageParams: {},
    });
    for (const dir of [roots.repoA, roots.repoB, defaultStories]) writeFileSync(path.join(dir, "deck.json"), deck);
    const ops = createMulmoScriptServerOps({
      storiesDir: defaultStories,
      extraRoots: roots,
      artifacts: stubFileOps,
      writeFileAtomic: async (absolutePath) => {
        written.push(absolutePath);
      },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    return { ops, written, roots, defaultStories };
  }

  it("writes under the named root, not the default one", async () => {
    const { ops, written, roots, defaultStories } = makeTwoRoots();
    await ops.uploadBeatImageOp("stories/deck.json", 0, PNG, "repoA");
    assert.equal(written.length, 1, "exactly one write");
    const target = written[0]!;
    assert.ok(target.startsWith(realpathSync(roots.repoA)), `wrote outside repoA: ${target}`);
    assert.ok(!target.startsWith(realpathSync(defaultStories)), `wrote into the DEFAULT root: ${target}`);
  });

  it("keeps two roots' identically-named decks apart", async () => {
    // The failure this replaces the guard's protection with: writing to
    // `repoB` must not touch `repoA`, though both hold `stories/deck.json`.
    const { ops, written, roots } = makeTwoRoots();
    await ops.uploadBeatImageOp("stories/deck.json", 0, PNG, "repoB");
    assert.equal(written.length, 1);
    assert.ok(written[0]!.startsWith(realpathSync(roots.repoB)));
    assert.ok(!written[0]!.startsWith(realpathSync(roots.repoA)));
  });

  it("still refuses an unregistered root — the containment did not move", async () => {
    const { ops, written } = makeTwoRoots();
    const result = await ops.uploadBeatImageOp("stories/deck.json", 0, PNG, "nope");
    assert.equal(result.ok, false);
    assert.equal(written.length, 0, "a refused upload must write nothing");
  });

  it("still refuses a traversal path — the containment did not move", async () => {
    const { ops, written } = makeTwoRoots();
    const result = await ops.uploadBeatImageOp("stories/../../escape.png", 0, PNG, "repoA");
    assert.equal(result.ok, false);
    assert.equal(written.length, 0, "a refused upload must write nothing");
  });

  it("the default root still works, unchanged", async () => {
    const { ops, written, defaultStories } = makeTwoRoots();
    await ops.uploadBeatImageOp("stories/deck.json", 0, PNG);
    assert.equal(written.length, 1);
    assert.ok(written[0]!.startsWith(realpathSync(defaultStories)));
  });
});

describe("who may generate in a named root is the HOST's answer", () => {
  // Generation was refused outright (#3015) because MulmoClaude's session store
  // keys pending work by `(kind, filePath, key)`, so two roots generating the
  // same beat in one session collapse to one entry. That hazard belongs to the
  // host, and MulmoTerminal does not have it — it ignores `chatSessionId` and
  // publishes to a pubsub channel the View filters by the pair. It was being
  // refused for a collision it cannot have (#3019).
  const namedRoot = "repoA";
  const REFUSAL = /generating in a non-default stories root is not supported yet/;

  function makeOpsWith(declared: boolean | undefined) {
    const generations: MulmoScriptGenerationEvent[] = [];
    const ops = createMulmoScriptServerOps({
      storiesDir: "/nonexistent/for-tests/artifacts/stories",
      extraRoots: { [namedRoot]: "/tmp/a" },
      ...(declared === undefined ? {} : { rootScopedGenerationState: declared }),
      artifacts: stubFileOps,
      writeFileAtomic: async () => {},
      onGenerationEvent: (_session, event) => generations.push(event),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    return { ops, generations };
  }

  it("refuses when the host says nothing — the shipped behaviour is the default", async () => {
    // An absent declaration must not quietly open a host that never thought
    // about this. That is the whole reason the flag defaults to off.
    const { ops } = makeOpsWith(undefined);
    const result = await ops.generateMovieOp("stories/deck.json", "session-1", namedRoot);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", REFUSAL);
  });

  it("refuses when the host declares it cannot keep roots apart", async () => {
    const { ops } = makeOpsWith(false);
    const result = await ops.generateMovieOp("stories/deck.json", "session-1", namedRoot);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", REFUSAL);
  });

  it("lets the generation start when the host declares it can", async () => {
    // It still fails — there is no such script on disk — but NOT for the root,
    // which is the difference between "refused" and "ran and did not find it".
    const { ops } = makeOpsWith(true);
    const result = await ops.generateMovieOp("stories/deck.json", "session-1", namedRoot);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.ok === false ? result.error : "", REFUSAL, "the root must no longer be the reason");
  });

  it("applies the declaration to every generation kind", async () => {
    // Swept, because the guard sits at five entry points and a kind that kept
    // the old blanket refusal would be invisible in a single-kind test.
    const { ops } = makeOpsWith(true);
    const results = [
      await ops.generateMovieOp("stories/deck.json", "s", namedRoot),
      await ops.generatePdfOp("stories/deck.json", "s", namedRoot),
      await ops.renderBeatOp({ filePath: "stories/deck.json", beatIndex: 0, chatSessionId: "s", root: namedRoot }),
      await ops.generateBeatAudioOp({ filePath: "stories/deck.json", beatIndex: 0, chatSessionId: "s", root: namedRoot }),
      await ops.renderCharacterOp({ filePath: "stories/deck.json", key: "alice", chatSessionId: "s", root: namedRoot }),
    ];
    for (const result of results) {
      assert.doesNotMatch(result.ok === false ? result.error : "", REFUSAL);
    }
  });

  it("never opens the DEFAULT root's behaviour either way", async () => {
    // The declaration is about named roots. A call naming no root was always
    // allowed and must stay exactly as it was.
    for (const declared of [undefined, false, true]) {
      const { ops } = makeOpsWith(declared);
      const result = await ops.generateMovieOp("stories/deck.json", "session-1");
      assert.doesNotMatch(result.ok === false ? result.error : "", REFUSAL, `declared=${declared}`);
    }
  });
});

describe("the boot warning says what is actually true for THIS host", () => {
  // The warning is the only thing a host integrator reads before discovering a
  // limit from a stuck spinner, so it must track the limits rather than repeat
  // the ones that applied when it was written (#3019).
  it("stops mentioning generation once the host declares it can scope it", () => {
    const warnings: string[] = [];
    createMulmoScriptServerOps({
      storiesDir: "/nonexistent/for-tests/artifacts/stories",
      extraRoots: { repoA: "/tmp/a" },
      rootScopedGenerationState: true,
      artifacts: stubFileOps,
      writeFileAtomic: async () => {},
      log: { info: () => {}, warn: (message) => warnings.push(message), error: () => {} },
    });
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(warnings[0]!, /GENERATION is refused/);
    assert.match(warnings[0]!, /save\/update still land in the DEFAULT root/);
  });
});

describe("`extraRoots` stays the containment boundary for writes", () => {
  // `artifactsForRoot` asks the host for a FileOps, and a host could answer for
  // an id it never declared. Registration is checked FIRST so that cannot
  // widen the addressable set — the same rule `resolveStory` holds for reads.
  //
  // Driven directly rather than through dispatch: there, `guardStoryWirePath`
  // would reject an unregistered root a moment later anyway, so a dispatch
  // test passes whether or not this check exists. It did — removing the
  // registration line left the suite green until this case was added (#3019).
  const served: FileOps = {
    read: async () => "{}",
    readBytes: async () => new Uint8Array(),
    write: async () => {},
    readDir: async () => [],
    stat: async () => ({ mtimeMs: 0, size: 0 }),
    exists: async () => true,
    unlink: async () => {},
  };

  function opsAnsweringEverything(extraRoots?: Record<string, string>) {
    return createMulmoScriptServerOps({
      storiesDir: "/nonexistent/for-tests/artifacts/stories",
      ...(extraRoots ? { extraRoots } : {}),
      artifacts: stubFileOps,
      // A host that hands back a FileOps for ANY id — the misconfiguration
      // this check exists to survive.
      artifactsFor: () => served,
      writeFileAtomic: async () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
  }

  it("serves no FileOps for a root that was never registered", () => {
    const ops = opsAnsweringEverything({ repoA: "/tmp/a" });
    assert.equal(ops.artifactsForRoot("never-registered"), null, "an unregistered id must not reach the host's resolver");
  });

  it("refuses the write for that root", () => {
    const ops = opsAnsweringEverything({ repoA: "/tmp/a" });
    const guard = ops.guardStoryWriteRoot("never-registered");
    assert.ok(guard !== null);
    assert.match(guard.error, /unknown stories root/);
  });

  it("serves the FileOps for a root that WAS registered", () => {
    // Otherwise the check above passes by refusing everything.
    const ops = opsAnsweringEverything({ repoA: "/tmp/a" });
    assert.equal(ops.artifactsForRoot("repoA"), served);
    assert.equal(ops.guardStoryWriteRoot("repoA"), null);
  });

  it("keeps the default root on its own FileOps, never the resolver's", () => {
    // The default root's writes must not start flowing through a host
    // resolver that answers for everything.
    const ops = opsAnsweringEverything();
    assert.equal(ops.artifactsForRoot(undefined), ops.backend.artifacts);
    assert.notEqual(ops.artifactsForRoot(undefined), served);
  });
});
