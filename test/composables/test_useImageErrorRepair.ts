import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairImageSrc, repairSourceSrc, IMAGE_REPAIR_PATTERN, IMAGE_REPAIR_INLINE_SCRIPT } from "../../src/composables/useImageErrorRepair.js";

// A tiny stand-in for HTMLImageElement — only the attributes the
// repair function reads/writes. Lets us exercise the pure function
// without a DOM.
interface FakeImg {
  src: string;
  dataset: { imageRepairTried?: string };
}

function makeImg(src: string): FakeImg {
  return { src, dataset: {} };
}

describe("repairImageSrc", () => {
  it("rewrites a wrong-prefix path that contains artifacts/images/<rest>", () => {
    const img = makeImg("http://localhost:5173/wrong/prefix/artifacts/images/2026/04/foo.png");
    const ok = repairImageSrc(img as unknown as HTMLImageElement);
    assert.equal(ok, true);
    assert.equal(img.src, "/artifacts/images/2026/04/foo.png");
    assert.equal(img.dataset.imageRepairTried, "1");
  });

  it("rewrites a relative path that contains the pattern", () => {
    const img = makeImg("../../../artifacts/images/2026/04/foo.png");
    const ok = repairImageSrc(img as unknown as HTMLImageElement);
    assert.equal(ok, true);
    assert.equal(img.src, "/artifacts/images/2026/04/foo.png");
  });

  it("leaves a src that doesn't contain the pattern alone", () => {
    const img = makeImg("/api/files/raw?path=data%2Fwiki%2Fsources%2Ffoo.png");
    const ok = repairImageSrc(img as unknown as HTMLImageElement);
    assert.equal(ok, false);
    assert.equal(img.src, "/api/files/raw?path=data%2Fwiki%2Fsources%2Ffoo.png");
    // The marker MUST NOT be set on a no-match: otherwise a later
    // repairable src on the same DOM element would be silently blocked.
    assert.equal(img.dataset.imageRepairTried, undefined);
  });

  it("a no-match call doesn't poison a later repairable src on the same element", () => {
    const img = makeImg("https://external.example.com/some.png");
    const first = repairImageSrc(img as unknown as HTMLImageElement);
    assert.equal(first, false);
    // Same DOM node, src now matches.
    img.src = "/wrong/prefix/artifacts/images/foo.png";
    const second = repairImageSrc(img as unknown as HTMLImageElement);
    assert.equal(second, true);
    assert.equal(img.src, "/artifacts/images/foo.png");
  });

  it("does not retry a second time once tried", () => {
    const img = makeImg("/wrong/artifacts/images/foo.png");
    const first = repairImageSrc(img as unknown as HTMLImageElement);
    assert.equal(first, true);
    assert.equal(img.src, "/artifacts/images/foo.png");
    // Simulate a second 404 — the flag should block the retry.
    img.src = "/still/wrong/artifacts/images/foo.png";
    const second = repairImageSrc(img as unknown as HTMLImageElement);
    assert.equal(second, false);
    assert.equal(img.src, "/still/wrong/artifacts/images/foo.png");
  });

  it("interpolates the same regex literal into the inline script", () => {
    // The inline script must reference the literal form of
    // `IMAGE_REPAIR_PATTERN` — not a hand-typed copy. If someone
    // edits the regex on the TS side and forgets the script string,
    // this test catches the drift via substring presence.
    assert.equal(IMAGE_REPAIR_PATTERN.source, "artifacts\\/images\\/.+");
    assert.ok(IMAGE_REPAIR_INLINE_SCRIPT.includes(IMAGE_REPAIR_PATTERN.toString()), "inline script must embed `IMAGE_REPAIR_PATTERN.toString()` verbatim");
  });
});

// Stand-in for HTMLSourceElement covering only what `repairSourceSrc`
// reads/writes. `getAttribute` / `setAttribute` mock keeps the test
// in the same plain-JS shape as the <img> stand-in above.
interface FakeSource {
  srcset?: string;
  attrs: Record<string, string>;
  dataset: { imageRepairTried?: string };
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
}

function makeSource(opts: { srcset?: string; src?: string } = {}): FakeSource {
  const attrs: Record<string, string> = {};
  if (opts.src !== undefined) attrs.src = opts.src;
  return {
    srcset: opts.srcset,
    attrs,
    dataset: {},
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) {
      attrs[name] = value;
    },
  };
}

describe("repairSourceSrc", () => {
  it("rewrites a wrong-prefix `src` attribute (audio/video <source> shape)", () => {
    const source = makeSource({ src: "/wrong/prefix/artifacts/images/foo.png" });
    const ok = repairSourceSrc(source as unknown as HTMLSourceElement);
    assert.equal(ok, true);
    assert.equal(source.attrs.src, "/artifacts/images/foo.png");
    assert.equal(source.dataset.imageRepairTried, "1");
  });

  it("rewrites a wrong-prefix `srcset` attribute (picture <source> shape)", () => {
    const source = makeSource({ srcset: "../../../artifacts/images/foo.png" });
    const ok = repairSourceSrc(source as unknown as HTMLSourceElement);
    assert.equal(ok, true);
    assert.equal(source.srcset, "/artifacts/images/foo.png");
  });

  it("preserves srcset descriptors while repairing each URL token", () => {
    const source = makeSource({ srcset: "../wrong/artifacts/images/foo.png 1x, ../wrong/artifacts/images/foo@2x.png 2x" });
    const ok = repairSourceSrc(source as unknown as HTMLSourceElement);
    assert.equal(ok, true);
    assert.equal(source.srcset, "/artifacts/images/foo.png 1x, /artifacts/images/foo@2x.png 2x");
  });

  it("leaves a `srcset` token that does not match the pattern alone", () => {
    const source = makeSource({ srcset: "https://external.example.com/foo.png 1x" });
    const ok = repairSourceSrc(source as unknown as HTMLSourceElement);
    assert.equal(ok, false);
    assert.equal(source.srcset, "https://external.example.com/foo.png 1x");
    // No marker on a no-match — same invariant as repairImageSrc.
    assert.equal(source.dataset.imageRepairTried, undefined);
  });

  it("repairs both `src` and `srcset` in one call when both match", () => {
    const source = makeSource({
      src: "/wrong/prefix/artifacts/images/poster.png",
      srcset: "../wrong/artifacts/images/foo.png 1x",
    });
    const ok = repairSourceSrc(source as unknown as HTMLSourceElement);
    assert.equal(ok, true);
    assert.equal(source.attrs.src, "/artifacts/images/poster.png");
    assert.equal(source.srcset, "/artifacts/images/foo.png 1x");
  });

  it("does not retry once tried", () => {
    const source = makeSource({ srcset: "/wrong/artifacts/images/foo.png" });
    assert.equal(repairSourceSrc(source as unknown as HTMLSourceElement), true);
    source.srcset = "/still/wrong/artifacts/images/foo.png";
    assert.equal(repairSourceSrc(source as unknown as HTMLSourceElement), false);
    assert.equal(source.srcset, "/still/wrong/artifacts/images/foo.png");
  });

  it("treats a missing src and missing srcset as a no-op", () => {
    const source = makeSource();
    assert.equal(repairSourceSrc(source as unknown as HTMLSourceElement), false);
    assert.equal(source.dataset.imageRepairTried, undefined);
  });
});

describe("IMAGE_REPAIR_INLINE_SCRIPT — Stage E parity", () => {
  it("references all four tag-name branches the document listener handles", () => {
    // Drift guard: the iframe-inlined script must match the TS
    // dispatcher in `useGlobalImageErrorRepair`. If the TS gains a
    // new branch, the inline must too — otherwise iframe surfaces
    // (presentHtml etc) silently regress for that case.
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /tagName === "IMG"/);
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /tagName === "SOURCE"/);
    // <audio>/<video> propagate child-source errors up to themselves.
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /tagName === "AUDIO"/);
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /tagName === "VIDEO"/);
    // The picture-sibling walk must also be in lock step.
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /closest\("picture"\)/);
    // The audio/video child walk uses `:scope > source` to avoid
    // grabbing the inner <picture><source> case (which is already
    // handled by the IMG branch via `closest("picture")`).
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /:scope > source/);
  });
});
