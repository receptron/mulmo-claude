// The identity of a script is the PAIR (root, filePath) — #3014.
//
// The generator and the property here are what survived the differential
// harness that proved the widening was behaviour-preserving: the harness
// itself could not, because half of it was the pre-#3014 code this replaced.
//
// What the harness established, and what these keep true:
//   - every call that names no root behaves exactly as it did before roots
//   - two roots holding the same wire path are two different scripts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeRoot, sameRoot, shouldReloadForScriptChange, type MulmoScriptChangedEvent } from "../src/core/contract.js";

// The inputs that mattered in the differential run: the wire spellings the
// module accepts, both "no root" spellings (absent and empty — they must be
// the same root), and the origin cases that drive the echo rule.
const PATHS = ["", "stories/a.json", "stories/b.json", "stories/x/y.json", "artifacts/stories/a.json"];
const ORIGINS: (string | undefined)[] = [undefined, "", "view-1", "view-2"];
const ABSENT_ROOTS: (string | undefined)[] = [undefined, ""];

describe("shouldReloadForScriptChange — the pre-roots world is unchanged", () => {
  /** The rule as it stood before roots: path equality plus the echo guard. */
  const beforeRoots = (event: MulmoScriptChangedEvent, watching: string, ownOrigin: string): boolean =>
    watching !== "" && event.filePath === watching && event.origin !== ownOrigin;

  interface NoRootCase {
    event: MulmoScriptChangedEvent;
    watching: string;
    ownOrigin: string;
    watchingRoot: string | undefined;
  }

  /** Every combination in which neither side names a root. */
  function noRootCases(): NoRootCase[] {
    const cases: NoRootCase[] = [];
    for (const filePath of PATHS)
      for (const watching of PATHS)
        for (const origin of ORIGINS)
          for (const ownOrigin of ORIGINS)
            for (const eventRoot of ABSENT_ROOTS)
              for (const watchingRoot of ABSENT_ROOTS) {
                // `exactOptionalPropertyTypes` is on: an optional field is
                // either present with a value or absent, never explicitly
                // `undefined`.
                const event: MulmoScriptChangedEvent = {
                  filePath,
                  ...(origin === undefined ? {} : { origin }),
                  ...(eventRoot === undefined ? {} : { root: eventRoot }),
                };
                cases.push({ event, watching, ownOrigin: ownOrigin ?? "", watchingRoot });
              }
    return cases;
  }

  it("matches the pre-#3014 rule for every call that names no root", () => {
    const cases = noRootCases();
    for (const { event, watching, ownOrigin, watchingRoot } of cases) {
      assert.equal(
        shouldReloadForScriptChange(event, watching, ownOrigin, watchingRoot),
        beforeRoots(event, watching, ownOrigin),
        `diverged for ${JSON.stringify({ event, watching, ownOrigin, watchingRoot })}`,
      );
    }
    assert.ok(cases.length >= 1000, `expected a real sweep, compared ${cases.length}`);
  });

  it("treats an absent root and an empty root as the same root", () => {
    const watching = "stories/deck.json";
    assert.equal(shouldReloadForScriptChange({ filePath: watching, root: "" }, watching, "me", undefined), true);
    assert.equal(shouldReloadForScriptChange({ filePath: watching }, watching, "me", ""), true);
  });
});

describe("shouldReloadForScriptChange — two roots are two scripts", () => {
  const watching = "stories/deck.json";

  it("does not reload a View watching another root's identically-named script", () => {
    assert.equal(shouldReloadForScriptChange({ filePath: watching, root: "repoA" }, watching, "me", "repoB"), false);
  });

  it("still reloads the View watching the root that changed", () => {
    assert.equal(shouldReloadForScriptChange({ filePath: watching, root: "repoA" }, watching, "me", "repoA"), true);
  });

  it("does not reload the default-root View when a named root changed", () => {
    // The case that makes the pair load-bearing: before #3014 this was a
    // path match, so a repository save redrew the workspace's canvas.
    assert.equal(shouldReloadForScriptChange({ filePath: watching, root: "repoA" }, watching, "me", undefined), false);
  });

  it("keeps the echo guard independent of the root", () => {
    // A View ignores its own write whatever root it is watching — otherwise a
    // keystroke rebuilds the element the caret is in.
    assert.equal(shouldReloadForScriptChange({ filePath: watching, root: "repoA", origin: "me" }, watching, "me", "repoA"), false);
  });
});

describe("one spelling of a root, shared by both sides", () => {
  // The server trims when it emits and keys; the View compares. When the two
  // used different rules, `publishGeneration` emitted `"repoA"` while a View
  // watching `" repoA "` dropped every event of its own generation
  // (CodeRabbit on #3015). Sixth finding of the same family on this PR — a
  // rule two sides must agree on, living on one of the two sides.
  it("collapses the default root's spellings", () => {
    assert.equal(normalizeRoot(undefined), "");
    assert.equal(normalizeRoot(""), "");
    assert.equal(normalizeRoot("   "), "");
  });

  it("trims a named root", () => {
    assert.equal(normalizeRoot(" repoA "), "repoA");
  });

  it("equates roots that differ only in surrounding whitespace", () => {
    assert.equal(sameRoot(" repoA ", "repoA"), true);
    assert.equal(sameRoot(undefined, "  "), true);
  });

  it("still separates two different named roots", () => {
    assert.equal(sameRoot("repoA", "repoB"), false);
    assert.equal(sameRoot("repoA", undefined), false);
  });

  it("carries the trim into the reload rule", () => {
    const watching = "stories/deck.json";
    assert.equal(shouldReloadForScriptChange({ filePath: watching, root: "repoA" }, watching, "me", " repoA "), true);
  });
});
