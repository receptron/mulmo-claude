import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { repairImageSrc, IMAGE_REPAIR_PATTERN, IMAGE_REPAIR_INLINE_SCRIPT } from "../../src/composables/useImageErrorRepair.js";

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

  it("matches the inline script's regex literally", () => {
    // Both the TS function and the iframe-inlined script use the same
    // pattern. Drift would silently break presentHtml's repair.
    assert.match(IMAGE_REPAIR_INLINE_SCRIPT, /artifacts\\\/images\\\/\.\+/);
    assert.equal(IMAGE_REPAIR_PATTERN.source, "artifacts\\/images\\/.+");
  });
});
