import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  renderWikiLinks,
  metaString,
  metaStringArray,
  formatUpdated,
  computeTagCounts,
  computeTagChips,
  computeToggledContent,
  shouldLazyLoadGraph,
} from "../../../src/plugins/wiki/helpers.js";

// Pin the timezone so `formatUpdated`'s local-time output is
// deterministic across CI machines (it formats in the runtime's default
// zone, which ICU reads from TZ). No Intl runs before this line, so the
// first `formatUpdated` call in a test body sees UTC.
process.env.TZ = "UTC";

const { document } = new JSDOM("<!doctype html><body></body>").window;

/** Build a container holding `count` rendered task checkboxes so
 *  `computeToggledContent` can index into them like the live DOM. */
function taskRoot(count: number): { root: HTMLElement; inputs: HTMLInputElement[] } {
  const root = document.createElement("div");
  root.innerHTML = Array.from({ length: count }, () => '<input class="md-task" type="checkbox">').join("");
  return { root, inputs: [...root.querySelectorAll<HTMLInputElement>("input.md-task")] };
}

describe("renderWikiLinks", () => {
  it("replaces a simple wiki link", () => {
    assert.equal(renderWikiLinks("See [[Home]] for details."), 'See <span class="wiki-link" data-page="Home">Home</span> for details.');
  });

  it("replaces multiple wiki links in one string", () => {
    assert.equal(renderWikiLinks("[[a]] and [[b]]"), '<span class="wiki-link" data-page="a">a</span> and <span class="wiki-link" data-page="b">b</span>');
  });

  it("leaves content without wiki links unchanged", () => {
    assert.equal(renderWikiLinks("just prose"), "just prose");
  });

  it("returns empty string for empty input", () => {
    assert.equal(renderWikiLinks(""), "");
  });

  it("leaves an empty bracket pair untouched", () => {
    // The old regex required at least one non-`]` char between
    // `[[` and `]]`. An empty `[[]]` is malformed and stays as-is.
    assert.equal(renderWikiLinks("[[]]"), "[[]]");
  });

  it("leaves a bare `[[` with no closing `]]` as literal text", () => {
    assert.equal(renderWikiLinks("open [[ but no close"), "open [[ but no close");
  });

  it("leaves `[[foo]bar]]` as literal — page name cannot contain `]`", () => {
    // The old `[^\]]+` made `]` illegal in the capture group;
    // the overall regex didn't match so the string was unchanged.
    assert.equal(renderWikiLinks("x [[foo]bar]] y"), "x [[foo]bar]] y");
  });

  it("handles triple brackets the same way the old regex did", () => {
    // `[[[foo]]]` → the old regex matched `[[[foo]]` greedily so
    // the page name became `[foo` (including the third `[`) and
    // the last `]` remained as trailing text. Preserve that quirk.
    assert.equal(renderWikiLinks("[[[foo]]]"), '<span class="wiki-link" data-page="[foo">[foo</span>]');
  });

  it("handles wiki links with spaces in the page name", () => {
    assert.equal(renderWikiLinks("[[My Page]]"), '<span class="wiki-link" data-page="My Page">My Page</span>');
  });

  it("handles adjacent wiki links with no separator", () => {
    assert.equal(renderWikiLinks("[[a]][[b]]"), '<span class="wiki-link" data-page="a">a</span><span class="wiki-link" data-page="b">b</span>');
  });

  it("preserves surrounding markdown syntax", () => {
    assert.equal(renderWikiLinks("- item: [[x]]"), '- item: <span class="wiki-link" data-page="x">x</span>');
  });

  // ── [[target|display]] alias form (#1297) ─────────────────────

  it("splits `[[slug|display]]` into data-page=slug + visible display", () => {
    // Pre-#1297 the whole bracket body went into both attributes, so
    // a click navigated to `/wiki/pages/keith-rabois-...|キース...`
    // (the resolver's fuzzy match still found the file but the URL
    // was ugly and the lint flagged the link as broken).
    assert.equal(
      renderWikiLinks("[[keith-rabois-ai-pm-end|キース・ラボイス]]"),
      '<span class="wiki-link" data-page="keith-rabois-ai-pm-end">キース・ラボイス</span>',
    );
  });

  it("trims whitespace on the target, preserves it on the display", () => {
    assert.equal(renderWikiLinks("[[  foo  |  Bar  ]]"), '<span class="wiki-link" data-page="foo">  Bar  </span>');
  });

  it("preserves additional pipes in the display half (only first pipe splits)", () => {
    // A display string can legitimately contain `|` (sub-title
    // separator etc.). Only the first pipe acts as the
    // target/display delimiter.
    assert.equal(renderWikiLinks("[[a|b|c]]"), '<span class="wiki-link" data-page="a">b|c</span>');
  });

  // ── XSS escaping (Codex review on PR #1312) ───────────────────

  it("HTML-escapes the target (attribute context)", () => {
    // A wiki page author writing `[[foo"onclick=alert(1)//]]` would
    // otherwise break out of the `data-page="…"` attribute and
    // execute the handler when the user clicks anything. Escape
    // before interpolation.
    assert.equal(
      renderWikiLinks(`[[foo"onclick=alert(1)//]]`),
      '<span class="wiki-link" data-page="foo&quot;onclick=alert(1)//">foo&quot;onclick=alert(1)//</span>',
    );
  });

  it("HTML-escapes the display (text context)", () => {
    // Same threat at the inner-text position — `[[foo|<img src=x onerror=alert(1)>]]`
    // would inject the img tag and execute the handler. Escape `<`/`>`
    // (and `&`) so the markup renders as plain text.
    assert.equal(renderWikiLinks("[[foo|<img src=x onerror=alert(1)>]]"), '<span class="wiki-link" data-page="foo">&lt;img src=x onerror=alert(1)&gt;</span>');
  });

  it("HTML-escapes `&` so existing entities aren't doubled (target + display)", () => {
    assert.equal(renderWikiLinks("[[a&b|c&d]]"), '<span class="wiki-link" data-page="a&amp;b">c&amp;d</span>');
  });
});

describe("metaString", () => {
  it("returns a non-empty string unchanged", () => {
    assert.equal(metaString("hello"), "hello");
  });

  it("collapses an empty string to null", () => {
    assert.equal(metaString(""), null);
  });

  it("returns null for non-string types (number, boolean, object, array)", () => {
    assert.equal(metaString(42), null);
    assert.equal(metaString(true), null);
    assert.equal(metaString({ a: 1 }), null);
    assert.equal(metaString(["a"]), null);
  });

  it("returns null for null and undefined", () => {
    assert.equal(metaString(null), null);
    assert.equal(metaString(undefined), null);
  });
});

describe("metaStringArray", () => {
  it("returns a string array unchanged", () => {
    assert.deepEqual(metaStringArray(["a", "b"]), ["a", "b"]);
  });

  it("drops non-string members from a mixed array", () => {
    assert.deepEqual(metaStringArray(["a", 1, null, "b", undefined, {}]), ["a", "b"]);
  });

  it("returns an empty array for an empty array", () => {
    assert.deepEqual(metaStringArray([]), []);
  });

  it("returns an empty array for non-array types (string, null, undefined)", () => {
    assert.deepEqual(metaStringArray("a"), []);
    assert.deepEqual(metaStringArray(null), []);
    assert.deepEqual(metaStringArray(undefined), []);
  });
});

describe("formatUpdated", () => {
  it("formats a UTC ISO timestamp as `YYYY-MM-DD HH:MM` (TZ pinned to UTC)", () => {
    assert.equal(formatUpdated("2026-04-27T14:32:56.789Z"), "2026-04-27 14:32");
  });

  it("renders midnight boundary as 00:00", () => {
    assert.equal(formatUpdated("2026-01-01T00:00:00.000Z"), "2026-01-01 00:00");
  });

  it("parses a date-only value to midnight", () => {
    assert.equal(formatUpdated("2026-04-27"), "2026-04-27 00:00");
  });

  it("falls back to the raw value when the input does not parse as a Date", () => {
    assert.equal(formatUpdated("not a date"), "not a date");
    assert.equal(formatUpdated(""), "");
  });
});

describe("computeTagCounts", () => {
  it("counts each tag across entries", () => {
    const counts = computeTagCounts([{ tags: ["a", "b"] }, { tags: ["a"] }, { tags: ["a", "b", "c"] }]);
    assert.equal(counts.get("a"), 3);
    assert.equal(counts.get("b"), 2);
    assert.equal(counts.get("c"), 1);
  });

  it("treats a missing tags field as no tags", () => {
    const counts = computeTagCounts([{}, { tags: ["a"] }]);
    assert.equal(counts.get("a"), 1);
    assert.equal(counts.size, 1);
  });

  it("returns an empty map for empty entries", () => {
    assert.equal(computeTagCounts([]).size, 0);
  });
});

describe("computeTagChips", () => {
  it("returns all qualifying tags, count desc then name asc, when fewer than target", () => {
    const chips = computeTagChips([{ tags: ["a", "b"] }, { tags: ["a", "b"] }, { tags: ["a"] }], 20);
    assert.deepEqual(chips, [
      ["a", 3],
      ["b", 2],
    ]);
  });

  it("excludes singleton tags (count === 1)", () => {
    const chips = computeTagChips([{ tags: ["a", "solo"] }, { tags: ["a"] }], 20);
    assert.deepEqual(chips, [["a", 2]]);
  });

  it("raises the cutoff to the count at the target position when more than target qualify", () => {
    const entries = [{ tags: ["x", "y", "z", "w"] }, { tags: ["x", "y", "z", "w"] }, { tags: ["x", "y", "z"] }, { tags: ["x", "y"] }, { tags: ["x"] }];
    // counts: x=5, y=4, z=3, w=2. target=2 → cutoff = count at index 1 = 4.
    assert.deepEqual(computeTagChips(entries, 2), [
      ["x", 5],
      ["y", 4],
    ]);
  });

  it("keeps tied tags at the cutoff boundary, so the row can exceed target", () => {
    const entries = [{ tags: ["x", "y", "z", "w"] }, { tags: ["x", "y", "z", "w"] }, { tags: ["x", "y", "z"] }, { tags: ["x"] }];
    // counts: x=4, y=3, z=3, w=2. target=2 → cutoff = count at index 1 = 3;
    // y and z tie at 3 so both survive even though target is 2.
    assert.deepEqual(computeTagChips(entries, 2), [
      ["x", 4],
      ["y", 3],
      ["z", 3],
    ]);
  });

  it("returns an empty array for empty entries", () => {
    assert.deepEqual(computeTagChips([], 20), []);
  });

  it("returns an empty array when every tag is a singleton", () => {
    assert.deepEqual(computeTagChips([{ tags: ["a", "b"] }, { tags: ["c"] }], 20), []);
  });
});

describe("shouldLazyLoadGraph", () => {
  it("loads on an existing page view when the graph is not yet loaded", () => {
    assert.equal(shouldLazyLoadGraph("page", true, false), true);
  });

  it("does not load when the graph is already loaded", () => {
    assert.equal(shouldLazyLoadGraph("page", true, true), false);
  });

  it("does not load when the page does not exist", () => {
    assert.equal(shouldLazyLoadGraph("page", false, false), false);
  });

  it("does not load on non-page actions", () => {
    assert.equal(shouldLazyLoadGraph("index", true, false), false);
    assert.equal(shouldLazyLoadGraph("log", true, false), false);
    assert.equal(shouldLazyLoadGraph("lint_report", true, false), false);
    assert.equal(shouldLazyLoadGraph("graph", true, false), false);
    assert.equal(shouldLazyLoadGraph("page-edit", true, false), false);
  });
});

describe("computeToggledContent", () => {
  it("toggles an unchecked task on", () => {
    const content = "- [ ] first\n- [x] second";
    const { root, inputs } = taskRoot(2);
    const result = computeToggledContent(inputs[0], root, content);
    assert.deepEqual(result, { status: "toggled", content: "- [x] first\n- [x] second" });
  });

  it("toggles a checked task off", () => {
    const content = "- [ ] first\n- [x] second";
    const { root, inputs } = taskRoot(2);
    const result = computeToggledContent(inputs[1], root, content);
    assert.deepEqual(result, { status: "toggled", content: "- [ ] first\n- [ ] second" });
  });

  it("leaves non-task lines and untoggled tasks untouched", () => {
    const content = "intro\n- [ ] a\nmiddle\n- [ ] b\noutro";
    const { root, inputs } = taskRoot(2);
    const result = computeToggledContent(inputs[0], root, content);
    assert.deepEqual(result, { status: "toggled", content: "intro\n- [x] a\nmiddle\n- [ ] b\noutro" });
  });

  it("preserves the frontmatter prefix when toggling the body", () => {
    const content = "---\ntitle: T\n---\n\n- [ ] task";
    const { root, inputs } = taskRoot(1);
    const result = computeToggledContent(inputs[0], root, content);
    assert.deepEqual(result, { status: "toggled", content: "---\ntitle: T\n---\n\n- [x] task" });
  });

  it("reports a mismatch when the DOM task count differs from the source", () => {
    const content = "- [ ] a\n- [ ] b";
    const { root, inputs } = taskRoot(1);
    const result = computeToggledContent(inputs[0], root, content);
    assert.deepEqual(result, { status: "mismatch" });
  });

  it("skips when the clicked input is not among the rendered tasks", () => {
    const content = "- [ ] a";
    const { root } = taskRoot(1);
    const stray = document.createElement("input");
    const result = computeToggledContent(stray, root, content);
    assert.deepEqual(result, { status: "skip" });
  });
});
