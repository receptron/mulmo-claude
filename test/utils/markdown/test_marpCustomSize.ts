import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyCustomMarpSize } from "@mulmoclaude/markdown-utils/markdown/marpCustomSize";

interface FakeThemeSet {
  add: (css: string) => void;
  calls: string[];
}

function makeFakeMarp(): { themeSet: FakeThemeSet } {
  const calls: string[] = [];
  return {
    themeSet: {
      add: (css: string) => calls.push(css),
      calls,
    },
  };
}

describe("applyCustomMarpSize — pass-through cases", () => {
  it("returns the input unchanged when there is no frontmatter", () => {
    const marp = makeFakeMarp();
    const source = "# heading\n\nbody";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("passes through size: 16:9 (Marp handles natively)", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 16:9\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("passes through size: 4:3", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 4:3\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("passes through when no size directive present", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\ntheme: gaia\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("passes through unrecognised non-numeric values", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: jumbotron\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });
});

describe("applyCustomMarpSize — numeric WxH", () => {
  it("registers a composite theme and rewrites frontmatter for `1080x1920`", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 1080x1920\n---\n# slide";
    const out = applyCustomMarpSize(marp, source);
    assert.equal(marp.themeSet.calls.length, 1);
    assert.match(marp.themeSet.calls[0], /@theme mc_size_default_1080x1920/);
    assert.match(marp.themeSet.calls[0], /section \{ width: 1080px; height: 1920px;/);
    assert.match(out, /theme: mc_size_default_1080x1920/);
    assert.doesNotMatch(out, /^size:/m);
  });

  it("accepts uppercase 'X' separator", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 1920X1080\n---\n# x";
    const out = applyCustomMarpSize(marp, source);
    assert.equal(marp.themeSet.calls.length, 1);
    assert.match(out, /mc_size_default_1920x1080/);
  });

  it("composes on top of the user's chosen theme", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\ntheme: gaia\nsize: 1080x1920\n---\n# x";
    const out = applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /@import "gaia"/);
    assert.match(out, /theme: mc_size_gaia_1080x1920/);
  });

  it("rejects implausibly small or non-numeric shapes", () => {
    const marp = makeFakeMarp();
    for (const bad of ["5x10", "10x10", "axb", "1080x", "x1920", "0x0"]) {
      const source = `---\nmarp: true\nsize: ${bad}\n---\n# x`;
      assert.equal(applyCustomMarpSize(marp, source), source, `should pass through size: ${bad}`);
    }
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("rejects implausibly large canvases (DoS guard)", () => {
    const marp = makeFakeMarp();
    // 3840 is the inclusive cap (4K width). Beyond that we refuse to
    // register a custom theme so Marp falls back to default 1280×720.
    for (const oversized of ["99999x99999", "9999x9999", "3841x720", "1280x3841", "5000x5000"]) {
      const source = `---\nmarp: true\nsize: ${oversized}\n---\n# x`;
      assert.equal(applyCustomMarpSize(marp, source), source, `should pass through size: ${oversized}`);
    }
    assert.equal(marp.themeSet.calls.length, 0);
  });

  it("accepts values at the cap boundary (3840 max, 200 min)", () => {
    const marp = makeFakeMarp();
    for (const ok of ["3840x2160", "2160x3840", "200x200", "1920x1080"]) {
      const source = `---\nmarp: true\nsize: ${ok}\n---\n# x`;
      const out = applyCustomMarpSize(marp, source);
      assert.notEqual(out, source, `should rewrite size: ${ok}`);
    }
    assert.equal(marp.themeSet.calls.length, 4);
  });

  it("is idempotent — re-applying with an already-generated theme name is a no-op", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\ntheme: mc_size_default_1080x1920\nsize: 1080x1920\n---\n# x";
    assert.equal(applyCustomMarpSize(marp, source), source);
    assert.equal(marp.themeSet.calls.length, 0);
  });
});

describe("applyCustomMarpSize — aspect-ratio presets", () => {
  it("maps `9:16` to 1080x1920 portrait", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 9:16\n---\n# x";
    const out = applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /width: 1080px; height: 1920px/);
    assert.match(out, /theme: mc_size_default_1080x1920/);
  });

  it("maps `16:10` to 1280x800", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 16:10\n---\n# x";
    const out = applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /width: 1280px; height: 800px/);
    assert.match(out, /theme: mc_size_default_1280x800/);
  });

  it("maps `1:1` to 1080x1080 square", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 1:1\n---\n# x";
    applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /width: 1080px; height: 1080px/);
  });
});

describe("applyCustomMarpSize — theme injection guard", () => {
  it("ignores a hostile theme name when composing the @import", () => {
    const marp = makeFakeMarp();
    // Frontmatter-controlled theme name with embedded quotes + @import.
    // Without the allowlist guard, this would land in the generated CSS
    // and cause Puppeteer to fetch the external stylesheet during PDF
    // render (no CSP on the server side).
    const hostile = `theme: '"; @import "https://evil.example.com/css"; /*'`;
    const source = `---\nmarp: true\n${hostile}\nsize: 1080x1920\n---\n# x`;
    const out = applyCustomMarpSize(marp, source);
    assert.equal(marp.themeSet.calls.length, 1);
    // The composed CSS must NOT carry the attacker's payload — the
    // unsafe theme should have been collapsed back to "default".
    assert.doesNotMatch(marp.themeSet.calls[0], /evil\.example\.com/);
    assert.match(marp.themeSet.calls[0], /@import "default"/);
    assert.match(out, /theme: mc_size_default_1080x1920/);
  });

  it("accepts whitelisted characters (alphanumeric / underscore / hyphen)", () => {
    const marp = makeFakeMarp();
    const source = `---\nmarp: true\ntheme: gaia_2\nsize: 1080x1920\n---\n# x`;
    applyCustomMarpSize(marp, source);
    assert.match(marp.themeSet.calls[0], /@import "gaia_2"/);
  });

  it("rejects theme names with whitespace, dots, or other CSS-relevant chars", () => {
    const marp = makeFakeMarp();
    for (const bad of ["my theme", "../etc/passwd", "theme;", 'default"', "ev/il"]) {
      const source = `---\nmarp: true\ntheme: ${JSON.stringify(bad)}\nsize: 1080x1920\n---\n# x`;
      applyCustomMarpSize(marp, source);
    }
    for (const call of marp.themeSet.calls) {
      assert.match(call, /@import "default"/);
    }
  });
});

describe("applyCustomMarpSize — body preservation", () => {
  it("preserves the body verbatim, including embedded slide separators", () => {
    const marp = makeFakeMarp();
    const source = "---\nmarp: true\nsize: 9:16\n---\n# Slide 1\n\nbody1\n\n---\n\n# Slide 2\n\nbody2\n";
    const out = applyCustomMarpSize(marp, source);
    assert.ok(out.includes("# Slide 1\n\nbody1\n\n---\n\n# Slide 2\n\nbody2\n"), "body should be preserved after the rewritten frontmatter");
  });
});
