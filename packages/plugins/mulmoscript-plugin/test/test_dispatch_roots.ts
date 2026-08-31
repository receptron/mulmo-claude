// The dispatch layer is what the agent's tool call actually reaches, and it
// had no test at all — the root guards were only ever exercised by calling the
// ops directly (#3015).
//
// That gap is why `uploadKind` could forward a root past `guardStoryWriteRoot`
// while `saveKind` and `updateKind` were guarded: nothing drove the kinds
// through the handler that routes them.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FileOps } from "gui-chat-protocol";
import { createMulmoScriptServerOps } from "../src/server/ops";
import { createMulmoScriptDispatchHandler } from "../src/server/dispatch";

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

const NAMED_ROOT = "repoA";
/** Every way a call can be refused BECAUSE of the root it named. `unknown
 *  stories root` joined the set when the write guard started checking
 *  registration first, which is the more accurate reason for a root nobody
 *  registered (#3019). */
const REFUSAL = /^((writing to|generating in) a non-default stories root is not supported yet|unknown stories root ".*")$/;

function makeDispatch() {
  const ops = createMulmoScriptServerOps({
    storiesDir: "/nonexistent/for-tests/artifacts/stories",
    extraRoots: { [NAMED_ROOT]: "/tmp/a" },
    artifacts: stubFileOps,
    writeFileAtomic: async () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return createMulmoScriptDispatchHandler(ops);
}

const isFailure = (value: unknown): value is { ok: false; code?: string; error: string } =>
  typeof value === "object" && value !== null && "ok" in value && (value as { ok: unknown }).ok === false;

/** Every kind that changes something, with the minimum args to reach the guard. */
const MUTATING_KINDS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["save", { filename: "deck.json", script: {} }],
  ["updateBeat", { filePath: "stories/deck.json", beatIndex: 0, beat: {} }],
  ["updateScript", { filePath: "stories/deck.json", script: {} }],
  ["generateMovie", { filePath: "stories/deck.json" }],
  ["generatePdf", { filePath: "stories/deck.json" }],
  ["renderBeat", { filePath: "stories/deck.json", beatIndex: 0 }],
  ["generateBeatAudio", { filePath: "stories/deck.json", beatIndex: 0 }],
  ["renderCharacter", { filePath: "stories/deck.json", key: "alice" }],
];

/** Every kind that only reads — a named root is legal for these (#3014). */
const READ_KINDS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ["beatImage", { filePath: "stories/deck.json", beatIndex: 0 }],
  ["beatAudio", { filePath: "stories/deck.json", beatIndex: 0 }],
  ["beatMovie", { filePath: "stories/deck.json", beatIndex: 0 }],
  ["characterImage", { filePath: "stories/deck.json", key: "alice" }],
  ["movieStatus", { filePath: "stories/deck.json" }],
  ["pdfStatus", { filePath: "stories/deck.json" }],
  ["pendingGenerations", { filePath: "stories/deck.json" }],
];

describe("dispatch refuses every mutating kind in a named root", () => {
  for (const [kind, args] of MUTATING_KINDS) {
    it(`${kind} is refused BECAUSE of the root`, async () => {
      const result = await makeDispatch()({ kind, ...args, root: NAMED_ROOT });
      assert.ok(isFailure(result), `${kind} must fail for a named root`);
      assert.equal(result.code, "bad_request", `${kind} must fail with bad_request`);
      // The reason, not just the failure: each of these also fails for an
      // unrelated reason here (no such script), so asserting failure alone
      // stays green with the guard gone.
      assert.match(result.error, REFUSAL, `${kind} must be refused for the ROOT`);
    });
  }

  it("covers every kind the handler routes as mutating", async () => {
    // The list above is an enumeration, and an enumeration is what let
    // `uploadKind` through. A kind the handler accepts but nobody listed is
    // exactly that hole, so ask the handler which kinds it knows.
    const unknown = await makeDispatch()({ kind: "definitelyNotAKind" });
    assert.ok(isFailure(unknown) && /unknown mulmoScript dispatch kind/.test(unknown.error));
    for (const [kind] of MUTATING_KINDS) {
      const routed = await makeDispatch()({ kind, root: NAMED_ROOT });
      assert.ok(isFailure(routed), `${kind} must be routed, not fall through`);
      assert.ok(!/unknown mulmoScript dispatch kind/.test(routed.error), `${kind} is not routed by the handler any more`);
    }
  });
});

describe("dispatch still serves the default root", () => {
  it("does not refuse a mutating kind that names no root", async () => {
    for (const [kind, args] of MUTATING_KINDS) {
      const result = await makeDispatch()({ kind, ...args });
      // It fails for its own reasons in this fixture, but never for the root.
      if (isFailure(result)) assert.doesNotMatch(result.error, REFUSAL, `${kind} must be allowed in the default root`);
    }
  });

  it("reads are allowed in a named root — that is the feature", async () => {
    const result = await makeDispatch()({ kind: "beatImage", filePath: "stories/deck.json", beatIndex: 0, root: NAMED_ROOT });
    if (isFailure(result)) assert.doesNotMatch(result.error, REFUSAL, "a read must never be refused for naming a root");
  });
});

describe("swept over generated arguments, a named root never gets a mutation through", () => {
  // Harvested from the differential harness that proved the `generateKind`
  // extraction (20250 generated argument combinations, 0 differences; a
  // swapped movie/PDF ternary produced 4860 and a dropped `root` 2430).
  //
  // The harness itself cannot survive — half of it is the pre-extraction
  // router. What outlives it is the GENERATOR (which argument shapes matter
  // here) and the PROPERTY, which needs no old code.
  //
  // The property is about the ANSWER, not about which function ran: the guards
  // live inside the ops, so `generateMovieOp` is legitimately entered and then
  // refuses. What must hold is that a named root never gets a mutation
  // through — every call is either refused for the root or rejected for its
  // arguments, and never anything else. Enumerating the guarded call sites is
  // what this PR got wrong five times; a sweep asserts the rule instead.
  const NAMED_ROOTS = ["repoA", " repoA ", "repoB"];
  const FILE_PATHS = [undefined, "", "stories/deck.json", "stories/../escape.json", "deck.json"];
  const BEATS = [undefined, 0, -1, "x"];
  const KEYS = [undefined, "", "alice"];
  const INVALID_ARGS = /invalid arguments|unknown mulmoScript dispatch kind/;

  /** Every mutating call the generator can build with a named root. */
  function namedRootMutations(): Record<string, unknown>[] {
    const calls: Record<string, unknown>[] = [];
    for (const [kind] of MUTATING_KINDS)
      for (const root of NAMED_ROOTS)
        for (const filePath of FILE_PATHS)
          for (const beatIndex of BEATS)
            for (const key of KEYS) {
              const args: Record<string, unknown> = { kind, root };
              if (filePath !== undefined) args.filePath = filePath;
              if (beatIndex !== undefined) args.beatIndex = beatIndex;
              if (key !== undefined) args.key = key;
              calls.push(args);
            }
    return calls;
  }

  it("answers every generated named-root mutation with a refusal", async () => {
    const dispatch = makeDispatch();
    const reasons = { root: 0, args: 0 };
    for (const args of namedRootMutations()) {
      const result = await dispatch(args);
      const where = JSON.stringify(args);
      assert.ok(isFailure(result), `${where} must not succeed`);
      if (REFUSAL.test(result.error)) reasons.root += 1;
      else if (INVALID_ARGS.test(result.error)) reasons.args += 1;
      else assert.fail(`${where} failed for neither the root nor its arguments: ${result.error}`);
    }
    // Neither branch may be vacuous: all-args-rejected would pass while the
    // root guard did nothing at all.
    assert.ok(reasons.root > 100, `the sweep must exercise the root refusal, saw ${reasons.root}`);
    assert.ok(reasons.args > 100, `the sweep must exercise argument rejection, saw ${reasons.args}`);
  });

  it("lets the same generated calls through when no root is named", async () => {
    // Without this the sweep above passes by refusing everything everywhere.
    const dispatch = makeDispatch();
    const result = await dispatch({ kind: "generateMovie", filePath: "stories/deck.json" });
    assert.ok(isFailure(result), "no script on disk, so it still fails");
    assert.doesNotMatch(result.error, REFUSAL, "but never for the root");
    assert.doesNotMatch(result.error, INVALID_ARGS, "and its arguments were fine");
  });
});

describe("an unregistered root is refused by every kind that takes one", () => {
  // The rule was enforced by whichever ops happened to call `resolveStory`,
  // which needs a file to exist. `pendingGenerations` needs none — it filters
  // an in-memory map — so `root: "nope"` answered `{ ok: true, pending: [] }`,
  // and a host typo or a stale card was indistinguishable from "no work is
  // running" (Codex P2 on #3015).
  //
  // That is the eleventh finding on this PR of one rule holding at the sites
  // that happened to reach it, so the check is over the SURFACE rather than
  // over a list: every kind the handler routes, called with a root nobody
  // registered, must fail. A new kind that forgets is red here.

  for (const [kind, args] of [...READ_KINDS, ...MUTATING_KINDS]) {
    it(`${kind} refuses root "nope"`, async () => {
      const result = await makeDispatch()({ kind, ...args, root: "nope" });
      assert.ok(isFailure(result), `${kind} must never answer successfully for a root nobody registered`);
      assert.equal(result.code, "bad_request", `${kind} must refuse an unknown root with bad_request`);
    });
  }

  // A root that is PRESENT but not a string. `str()` flattens all of these to
  // `undefined`, which every reader below took as "no root named" — the
  // default root. A host serialising a root wrongly would then read and write
  // the default root's identically-named script while believing it named
  // another (Codex P2 on #3015).
  const MALFORMED_ROOTS: ReadonlyArray<[string, unknown]> = [
    ["null", null],
    ["number", 1],
    ["object", {}],
    ["array", ["repoA"]],
    ["boolean", true],
  ];

  for (const [label, root] of MALFORMED_ROOTS) {
    it(`every kind refuses a ${label} root`, async () => {
      for (const [kind, args] of [...READ_KINDS, ...MUTATING_KINDS]) {
        const result = await makeDispatch()({ kind, ...args, root });
        assert.ok(isFailure(result), `${kind} must refuse a ${label} root`);
        assert.equal(result.code, "bad_request", `${kind} must refuse a ${label} root with bad_request`);
        assert.match(result.error, /root must be a string/, `${kind} must say WHY — a ${label} root is not a missing one`);
      }
    });
  }

  it("the same kinds answer when the root IS registered", async () => {
    // Otherwise the sweep above passes by refusing everything unconditionally.
    const registered = await makeDispatch()({ kind: "pendingGenerations", filePath: "stories/deck.json", root: NAMED_ROOT });
    assert.equal(isFailure(registered), false, "a registered root must get its (empty) snapshot");
  });

  it("and answer when no root is named at all", async () => {
    const bare = await makeDispatch()({ kind: "pendingGenerations", filePath: "stories/deck.json" });
    assert.equal(isFailure(bare), false);
  });
});

describe("a result carries the root it acted in", () => {
  // A host builds its cards from these results, and a card's identity is the
  // PAIR `(root, filePath)` — `stories/deck.json` exists in every registered
  // root. #3015 threaded `root` through the ARGS and the EVENTS and not
  // through the results, so a host could not tell two repositories' decks
  // apart no matter what it did on its side (#3019).
  const isOk = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === true;

  it("stamps a named root on every kind that succeeds", async () => {
    // Swept rather than listed: the tag is applied once at the router, and
    // this is what says so. A kind that somehow bypassed it shows up here.
    const dispatch = makeDispatch();
    let stamped = 0;
    for (const [kind, args] of [...READ_KINDS, ...MUTATING_KINDS]) {
      const result = await dispatch({ kind, ...args, root: NAMED_ROOT });
      if (!isOk(result)) continue;
      assert.equal(result.root, NAMED_ROOT, `${kind} succeeded without naming its root`);
      stamped += 1;
    }
    assert.ok(stamped > 0, "the sweep must actually reach a succeeding kind");
  });

  it("leaves a default-root result byte-identical to the pre-roots one", async () => {
    // The compatibility claim: a call that names no root must return exactly
    // what this package returned before roots existed, with no `root` key at
    // all — an explicit `root: undefined` is a different object on the wire.
    const result = await makeDispatch()({ kind: "pendingGenerations", filePath: "stories/deck.json" });
    assert.deepEqual(result, { ok: true, pending: [] });
    assert.ok(isOk(result) && !("root" in result));
  });

  it("treats an empty or whitespace root as the default one", async () => {
    for (const root of ["", "   "]) {
      const result = await makeDispatch()({ kind: "pendingGenerations", filePath: "stories/deck.json", root });
      assert.deepEqual(result, { ok: true, pending: [] }, `root ${JSON.stringify(root)}`);
    }
  });

  it("normalises the root it stamps", async () => {
    // The stamped value is what the host persists in a card, so it must be
    // the same string the next call has to name — not the caller's spelling.
    const result = await makeDispatch()({ kind: "pendingGenerations", filePath: "stories/deck.json", root: `  ${NAMED_ROOT}  ` });
    assert.ok(isOk(result));
    assert.equal(result.root, NAMED_ROOT);
  });

  it("never stamps a root on a failure", async () => {
    // A failure means the call did not happen. Tagging it would invite a
    // reader to treat the pair as addressable when it is not.
    const refused = await makeDispatch()({ kind: "save", filename: "d.json", script: {}, root: NAMED_ROOT });
    assert.ok(isFailure(refused));
    assert.ok(!("root" in (refused as Record<string, unknown>)));
    const unknownRoot = await makeDispatch()({ kind: "pendingGenerations", filePath: "stories/deck.json", root: "nope" });
    assert.ok(isFailure(unknownRoot));
    assert.ok(!("root" in (unknownRoot as Record<string, unknown>)));
  });
});

describe("a write lands in the root it names — and can be read back", () => {
  // The one thing that was genuinely blocked (#3015 review G1): the executors
  // ran against ONE FileOps bound to the default root, so a write naming
  // another root rewrote the DEFAULT root's identically-named script.
  //
  // Driven through a REAL FileOps over a real directory, and the assertion is
  // a ROUND TRIP: write, then resolve the wire path the write handed back and
  // read the bytes at that absolute path. The first version of these cases used
  // a `Map` keyed by the FileOps-relative path, which cannot see WHERE the
  // bytes landed — and it stayed green while `save` reported success and
  // returned a wire path that resolved to nothing, because the write went to
  // `<root>/stories/<rel>` and the read looked in `<root>/<rel>`
  // (#3020 review H1, from the consuming host).
  const NAMED = "repoA";
  const workspaces: string[] = [];
  after(() => workspaces.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** What a host actually injects: a FileOps rooted at one directory. */
  function realFileOps(root: string): FileOps {
    const abs = (p: string) => path.join(root, p);
    return {
      read: async (p) => readFileSync(abs(p), "utf8"),
      readBytes: async (p) => new Uint8Array(readFileSync(abs(p))),
      write: async (p, data) => {
        mkdirSync(path.dirname(abs(p)), { recursive: true });
        writeFileSync(abs(p), typeof data === "string" ? data : Buffer.from(data));
      },
      readDir: async () => [],
      stat: async () => ({ mtimeMs: 0, size: 0 }),
      exists: async (p) => existsSync(abs(p)),
      unlink: async (p) => rmSync(abs(p), { force: true }),
    };
  }

  const DECK = {
    $mulmocast: { version: "1.1" },
    title: "Original",
    lang: "en",
    beats: [{ speaker: "N", text: "b", image: { type: "textSlide", slide: { title: "S", bullets: ["b"] } } }],
    imageParams: {},
  };

  /**
   * The directory shape a host writes: the registered directory IS the FileOps
   * root for a named root, while the default root's FileOps sits one level up
   * at `<workspace>/artifacts` because it is shared with other plugins.
   */
  function makeDirs(prefix: string) {
    const base = mkdtempSync(path.join(tmpdir(), prefix));
    workspaces.push(base);
    const artifactsDir = path.join(base, "ws", "artifacts");
    const dirs = { base, artifactsDir, namedDir: path.join(base, "repoA"), defaultDir: path.join(artifactsDir, "stories") };
    for (const dir of [dirs.namedDir, dirs.defaultDir]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "deck.json"), JSON.stringify(DECK));
    }
    return dirs;
  }

  function makeHost(opts: { serveNamed: boolean }) {
    const dirs = makeDirs("mulmoscript-write-");
    const ops = createMulmoScriptServerOps({
      storiesDir: dirs.defaultDir,
      extraRoots: { [NAMED]: dirs.namedDir },
      artifacts: realFileOps(dirs.artifactsDir),
      ...(opts.serveNamed ? { artifactsFor: (root: string) => (root === NAMED ? realFileOps(dirs.namedDir) : null) } : {}),
      writeFileAtomic: async () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    return { ops, dispatch: createMulmoScriptDispatchHandler(ops), ...dirs };
  }

  /** A host that hands back a FileOps for ANY id, including ones it never
   *  registered — the misconfiguration `extraRoots` has to survive. */
  function hostAnsweringEverything() {
    const base = mkdtempSync(path.join(tmpdir(), "mulmoscript-unreg-"));
    workspaces.push(base);
    const artifactsDir = path.join(base, "ws", "artifacts");
    const defaultDir = path.join(artifactsDir, "stories");
    const elsewhere = path.join(base, "elsewhere");
    for (const dir of [defaultDir, elsewhere]) mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(defaultDir, "deck.json"), JSON.stringify(DECK));
    const ops = createMulmoScriptServerOps({
      storiesDir: defaultDir,
      artifacts: realFileOps(artifactsDir),
      artifactsFor: () => realFileOps(elsewhere),
      writeFileAtomic: async () => {},
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    return { dispatch: createMulmoScriptDispatchHandler(ops), elsewhere };
  }

  /** The title at the wire path, read through the resolver a READER uses. */
  function titleAt(ops: ReturnType<typeof createMulmoScriptServerOps>, wirePath: string, root?: string): string | null {
    const resolved = ops.resolveStory(wirePath, root);
    if (!resolved.ok) return null;
    return (JSON.parse(readFileSync(resolved.absolutePath, "utf8")) as { title: string }).title;
  }

  it("updateScript writes where a reader will look, leaving the default root alone", async () => {
    const { ops, dispatch, defaultDir } = makeHost({ serveNamed: true });
    const result = await dispatch({ kind: "updateScript", filePath: "stories/deck.json", script: { ...DECK, title: "Rewritten in repoA" }, root: NAMED });

    assert.deepEqual(result, { ok: true, root: NAMED });
    assert.equal(titleAt(ops, "stories/deck.json", NAMED), "Rewritten in repoA", "the named root must read back the new bytes");
    assert.equal(titleAt(ops, "stories/deck.json"), "Original", "the DEFAULT root must be untouched — this is the bug being fixed");
    assert.ok(!existsSync(path.join(defaultDir, "..", "stories", "deck.json.tmp")));
  });

  it("save hands back a wire path that resolves to the file it wrote", async () => {
    // The silent failure: `save` reported success and returned a wire path
    // that resolved to nothing, because the bytes went one directory deeper.
    const { ops, dispatch } = makeHost({ serveNamed: true });
    const result = (await dispatch({ kind: "save", filename: "talk.json", script: DECK, root: NAMED })) as Record<string, unknown>;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.root, NAMED);
    const wirePath = String(result.filePath);
    assert.match(wirePath, /^stories\//, "the wire form is what the host stores in a card");
    assert.equal(titleAt(ops, wirePath, NAMED), "Original", `the wire path ${wirePath} must resolve to the file that was written`);
  });

  it("still writes the default root when no root is named", async () => {
    const { ops, dispatch } = makeHost({ serveNamed: true });
    const result = await dispatch({ kind: "updateScript", filePath: "stories/deck.json", script: { ...DECK, title: "Rewritten in the workspace" } });

    assert.deepEqual(result, { ok: true }, "a default-root result stays byte-identical to the pre-roots one");
    assert.equal(titleAt(ops, "stories/deck.json"), "Rewritten in the workspace");
    assert.equal(titleAt(ops, "stories/deck.json", NAMED), "Original", "a named root must not receive a workspace write");
  });

  it("refuses when the host serves no FileOps for that root", async () => {
    const { ops, dispatch } = makeHost({ serveNamed: false });
    const result = await dispatch({ kind: "updateScript", filePath: "stories/deck.json", script: { ...DECK, title: "Should not land" }, root: NAMED });

    assert.ok(isFailure(result));
    assert.equal(result.code, "bad_request");
    assert.equal(titleAt(ops, "stories/deck.json", NAMED), "Original", "a refused write must touch nothing");
    assert.equal(titleAt(ops, "stories/deck.json"), "Original");
  });

  it("refuses a root the host resolves but never registered", async () => {
    // `extraRoots` stays the containment boundary: a host cannot widen the
    // addressable set by answering `artifactsFor` for an id it never declared.
    const { dispatch, elsewhere } = hostAnsweringEverything();
    const result = await dispatch({ kind: "updateScript", filePath: "stories/deck.json", script: DECK, root: "never-registered" });

    assert.ok(isFailure(result));
    assert.match(result.error, /unknown stories root/);
    assert.deepEqual(readdirSync(elsewhere), [], "nothing may be written into an unregistered root");
  });
});
