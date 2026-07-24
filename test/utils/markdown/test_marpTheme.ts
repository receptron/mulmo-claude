import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureThemeDirective, MARP_HTML_ALLOWLIST, marpThemeNameFromFilename, sanitizeMarpThemeCss } from "@mulmoclaude/markdown-utils/markdown/marpTheme";

describe("marpThemeNameFromFilename", () => {
  it("strips the .css extension", () => {
    assert.equal(marpThemeNameFromFilename("corporate.css"), "corporate");
  });

  it("accepts dashes and underscores", () => {
    assert.equal(marpThemeNameFromFilename("dark-mode_v2.css"), "dark-mode_v2");
  });

  it("rejects files that are not .css", () => {
    assert.equal(marpThemeNameFromFilename("corporate.txt"), null);
    assert.equal(marpThemeNameFromFilename("corporate"), null);
  });

  it("rejects names with characters outside [A-Za-z0-9_-]", () => {
    assert.equal(marpThemeNameFromFilename("ja 日本語.css"), null);
    assert.equal(marpThemeNameFromFilename("with.dot.css"), null);
    assert.equal(marpThemeNameFromFilename("with space.css"), null);
  });

  it("accepts a mixed-case extension", () => {
    assert.equal(marpThemeNameFromFilename("Corporate.CSS"), "Corporate");
  });
});

describe("ensureThemeDirective", () => {
  it("adds a directive when none exists", () => {
    const css = "section { background: navy; }";
    assert.equal(ensureThemeDirective(css, "corporate"), "/* @theme corporate */\nsection { background: navy; }");
  });

  it("replaces an existing directive with the canonical name", () => {
    const css = "/* @theme totally-different */\nsection { background: navy; }";
    assert.equal(ensureThemeDirective(css, "corporate"), "/* @theme corporate */\nsection { background: navy; }");
  });

  it("trims leading whitespace left by the replaced directive", () => {
    const css = "  /* @theme old */  \n\nsection { color: red; }";
    assert.equal(ensureThemeDirective(css, "fresh"), "/* @theme fresh */\nsection { color: red; }");
  });
});

describe("sanitizeMarpThemeCss", () => {
  it("accepts plain CSS", () => {
    assert.equal(sanitizeMarpThemeCss("section { background: navy; }").ok, true);
  });

  it("accepts data: URLs (inline fonts)", () => {
    const css = `@font-face { font-family: 'X'; src: url(data:font/woff2;base64,abc) format('woff2'); }`;
    assert.equal(sanitizeMarpThemeCss(css).ok, true);
  });

  it("rejects external @import url(http...)", () => {
    const css = `@import url("http://attacker.example/track.css");`;
    const result = sanitizeMarpThemeCss(css);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /@import/);
  });

  it("rejects external @import url(https...)", () => {
    assert.equal(sanitizeMarpThemeCss(`@import url(https://example.com/x.css);`).ok, false);
  });

  it("rejects bare-string @import 'http://...'", () => {
    assert.equal(sanitizeMarpThemeCss(`@import "http://example.com/x.css";`).ok, false);
  });

  it("rejects url(http://...) inside font-face src", () => {
    const css = `@font-face { font-family: 'X'; src: url(http://attacker.example/leak.woff2); }`;
    assert.equal(sanitizeMarpThemeCss(css).ok, false);
  });

  it("rejects protocol-relative @import url(//host/...)", () => {
    assert.equal(sanitizeMarpThemeCss(`@import url(//attacker.example/x.css);`).ok, false);
    assert.equal(sanitizeMarpThemeCss(`@import url("//attacker.example/x.css");`).ok, false);
    assert.equal(sanitizeMarpThemeCss(`@import url('//attacker.example/x.css');`).ok, false);
  });

  it("rejects protocol-relative @import bare-string //host/...", () => {
    assert.equal(sanitizeMarpThemeCss(`@import "//attacker.example/x.css";`).ok, false);
    assert.equal(sanitizeMarpThemeCss(`@import '//attacker.example/x.css';`).ok, false);
  });

  it("rejects protocol-relative url(//host/...) in font-face / background", () => {
    const css = `@font-face { font-family: 'X'; src: url(//attacker.example/leak.woff2); }`;
    assert.equal(sanitizeMarpThemeCss(css).ok, false);
    assert.equal(sanitizeMarpThemeCss(`section { background-image: url("//ev.example/track.png"); }`).ok, false);
  });

  it("rejects external refs padded with 9+ whitespace chars (bounded-regex bypass guard)", () => {
    // The first cut bounded `\s{0,8}` so 9 spaces would slip past.
    // Now the sanitizer strips all whitespace before matching.
    const tenSpaces = " ".repeat(10);
    const fiftyTabs = "\t".repeat(50);
    const manyNewlines = "\n".repeat(100);
    assert.equal(sanitizeMarpThemeCss(`url${tenSpaces}("http://attacker.example/x.css")`).ok, false);
    assert.equal(sanitizeMarpThemeCss(`url(${fiftyTabs}//attacker.example/x.css)`).ok, false);
    assert.equal(sanitizeMarpThemeCss(`@import${manyNewlines}"http://attacker.example/x.css";`).ok, false);
    assert.equal(sanitizeMarpThemeCss(`@import url${tenSpaces}(${manyNewlines}//attacker.example/x.css)`).ok, false);
  });

  it("does not confuse `//` inside a CSS comment for a protocol", () => {
    // `// ...` is not CSS comment syntax (block comments use `/* */`),
    // but the test guards against an over-eager match. A real
    // sample we want to keep accepting: a CSS line-end `// note`
    // pseudo-comment would not appear in a parsed sheet anyway —
    // the surrounding `;` / `}` keeps the engine sane. Here we
    // assert plain `data:` and relative paths still pass.
    assert.equal(sanitizeMarpThemeCss(`@font-face { src: url(data:font/woff2;base64,abc); }`).ok, true);
    assert.equal(sanitizeMarpThemeCss(`section { background-image: url(./bg.png); }`).ok, true);
    assert.equal(sanitizeMarpThemeCss(`section { background-image: url("../assets/x.svg"); }`).ok, true);
  });
});

describe("MARP_HTML_ALLOWLIST", () => {
  it("includes the layout tags users actually want", () => {
    const keys = Object.keys(MARP_HTML_ALLOWLIST);
    for (const tag of ["div", "span", "img", "br", "sub", "sup", "small"]) {
      assert.ok(keys.includes(tag), `missing tag: ${tag}`);
    }
  });

  it("explicitly excludes script / iframe / form / link / style / object", () => {
    const keys = Object.keys(MARP_HTML_ALLOWLIST);
    for (const tag of ["script", "iframe", "form", "input", "button", "link", "style", "meta", "object", "embed", "applet"]) {
      assert.ok(!keys.includes(tag), `forbidden tag must NOT be in allowlist: ${tag}`);
    }
  });

  it("does not list event-handler attributes on any tag", () => {
    for (const [tag, attrs] of Object.entries(MARP_HTML_ALLOWLIST)) {
      for (const attr of attrs) {
        assert.ok(!attr.startsWith("on"), `tag ${tag} must not allow event handler ${attr}`);
      }
    }
  });

  it("img allows src/alt/width/height plus the layout attrs", () => {
    const attrs = MARP_HTML_ALLOWLIST.img ?? [];
    for (const expected of ["src", "alt", "width", "height", "class", "style"]) {
      assert.ok(attrs.includes(expected), `img missing attr: ${expected}`);
    }
  });
});
