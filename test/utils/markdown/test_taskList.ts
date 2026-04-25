import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { findTaskLines, toggleTaskAt, makeTasksInteractive } from "../../../src/utils/markdown/taskList.js";

describe("toggleTaskAt", () => {
  it("toggles unchecked → checked", () => {
    const out = toggleTaskAt("- [ ] one\n- [ ] two\n", 0);
    assert.equal(out, "- [x] one\n- [ ] two\n");
  });

  it("toggles checked → unchecked", () => {
    const out = toggleTaskAt("- [x] done\n", 0);
    assert.equal(out, "- [ ] done\n");
  });

  it("targets the n-th task by index", () => {
    const markdown = "- [ ] zero\n- [x] one\n- [ ] two\n";
    assert.equal(toggleTaskAt(markdown, 1), "- [ ] zero\n- [ ] one\n- [ ] two\n");
    assert.equal(toggleTaskAt(markdown, 2), "- [ ] zero\n- [x] one\n- [x] two\n");
  });

  it("preserves indentation and bullet style", () => {
    const markdown = "  * [ ] indented star\n  + [X] indented plus\n";
    assert.equal(toggleTaskAt(markdown, 0), "  * [x] indented star\n  + [X] indented plus\n");
    assert.equal(toggleTaskAt(markdown, 1), "  * [ ] indented star\n  + [ ] indented plus\n");
  });

  it("preserves trailing content after the marker", () => {
    const markdown = "- [ ] foo **bold** [link](#)\n";
    assert.equal(toggleTaskAt(markdown, 0), "- [x] foo **bold** [link](#)\n");
  });

  it("ordered-list task syntax counts toward the index (dot marker)", () => {
    const markdown = "1. [ ] alpha\n2. [ ] beta\n";
    assert.equal(toggleTaskAt(markdown, 1), "1. [ ] alpha\n2. [x] beta\n");
  });

  it("ordered-list task syntax counts toward the index (paren marker)", () => {
    // CommonMark / GFM also accepts `1)` style ordered markers, and
    // marked renders them as task checkboxes — so the source walker
    // must too.
    const markdown = "1) [ ] alpha\n2) [x] beta\n";
    assert.equal(toggleTaskAt(markdown, 0), "1) [x] alpha\n2) [x] beta\n");
    assert.equal(toggleTaskAt(markdown, 1), "1) [ ] alpha\n2) [ ] beta\n");
  });

  it("skips fenced code blocks (``` … ```) — task-looking lines inside don't count", () => {
    const markdown = ["- [ ] real-1", "```", "- [ ] not-a-task", "- [x] also-not", "```", "- [ ] real-2"].join("\n");
    // Index 1 is real-2 (the inside-fence lines are skipped).
    const out = toggleTaskAt(markdown, 1);
    assert.equal(out, ["- [ ] real-1", "```", "- [ ] not-a-task", "- [x] also-not", "```", "- [x] real-2"].join("\n"));
  });

  it("skips tilde-fenced code blocks", () => {
    const markdown = ["- [ ] real-1", "~~~", "- [ ] inside", "~~~", "- [ ] real-2"].join("\n");
    const out = toggleTaskAt(markdown, 1);
    assert.equal(out, ["- [ ] real-1", "~~~", "- [ ] inside", "~~~", "- [x] real-2"].join("\n"));
  });

  it("opener and closer fence markers must use the same character", () => {
    // ``` opens, ~~~ does NOT close it — anything between the ``` and
    // the matching ``` is fenced.
    const markdown = ["```", "- [ ] inside", "~~~", "- [ ] also-inside", "```", "- [ ] outside"].join("\n");
    const out = toggleTaskAt(markdown, 0);
    assert.equal(out, ["```", "- [ ] inside", "~~~", "- [ ] also-inside", "```", "- [x] outside"].join("\n"));
  });

  it("returns null when index is out of range", () => {
    assert.equal(toggleTaskAt("- [ ] only\n", 1), null);
    assert.equal(toggleTaskAt("no tasks here\n", 0), null);
  });

  it("returns null for negative or non-integer indices", () => {
    assert.equal(toggleTaskAt("- [ ] x\n", -1), null);
    assert.equal(toggleTaskAt("- [ ] x\n", 0.5), null);
    assert.equal(toggleTaskAt("- [ ] x\n", Number.NaN), null);
  });

  it("does not modify lines that aren't task list markers", () => {
    const markdown = "- regular bullet\n- [ ] task\n- another bullet\n";
    assert.equal(toggleTaskAt(markdown, 0), "- regular bullet\n- [x] task\n- another bullet\n");
  });

  it("preserves trailing newline / no-trailing-newline shape", () => {
    assert.equal(toggleTaskAt("- [ ] x", 0), "- [x] x");
    assert.equal(toggleTaskAt("- [ ] x\n", 0), "- [x] x\n");
  });

  // ── Blockquoted tasks ─────────────────────────────────────────
  // marked renders these as real task checkboxes; the index walker
  // must count them so DOM and source stay aligned.

  it("toggles a task inside a single-level blockquote", () => {
    assert.equal(toggleTaskAt("> - [ ] quoted\n", 0), "> - [x] quoted\n");
  });

  it("toggles a task inside a nested blockquote", () => {
    assert.equal(toggleTaskAt("> > - [ ] nested\n", 0), "> > - [x] nested\n");
  });

  it("counts blockquoted tasks alongside top-level tasks", () => {
    const markdown = "- [ ] top-0\n> - [ ] quoted-1\n- [ ] top-2\n";
    assert.equal(toggleTaskAt(markdown, 1), "- [ ] top-0\n> - [x] quoted-1\n- [ ] top-2\n");
    assert.equal(toggleTaskAt(markdown, 2), "- [ ] top-0\n> - [ ] quoted-1\n- [x] top-2\n");
  });

  it("handles indented blockquote prefixes", () => {
    assert.equal(toggleTaskAt("   > - [ ] indented quote\n", 0), "   > - [x] indented quote\n");
  });

  // ── Fence indent / length corner cases ────────────────────────

  it("does NOT treat a 4-space-indented ``` as a fence opener", () => {
    // CommonMark allows fences indented up to 3 spaces; ≥ 4 is
    // literal content of an indented code block. Verified by the
    // top-level task matching at index 0 — if the 4-space ``` had
    // (incorrectly) opened a fence, the task counter would never
    // reach the real task on the bottom line.
    const markdown = "    ```\n- [ ] real\n    ```\n";
    assert.equal(toggleTaskAt(markdown, 0), "    ```\n- [x] real\n    ```\n");
  });

  it("a shorter closer does NOT close a longer opener", () => {
    // ```` (4 backticks) opens; ``` (3 backticks) is too short to
    // close per CommonMark — the closer must be ≥ opener length.
    const markdown = ["````", "- [ ] inside", "```", "- [x] still-inside", "````", "- [ ] outside"].join("\n");
    const out = toggleTaskAt(markdown, 0);
    assert.equal(out, ["````", "- [ ] inside", "```", "- [x] still-inside", "````", "- [x] outside"].join("\n"));
  });

  it("a longer closer DOES close a shorter opener", () => {
    // ``` (3) opens; ```` (4 ≥ 3) closes. Then a top-level task at
    // the bottom is index 0.
    const markdown = ["```", "- [ ] inside", "````", "- [ ] outside"].join("\n");
    const out = toggleTaskAt(markdown, 0);
    assert.equal(out, ["```", "- [ ] inside", "````", "- [x] outside"].join("\n"));
  });

  it("a closer with an info string is NOT a valid closer", () => {
    // Per CommonMark §4.5, fence closers can't carry an info
    // string — only trailing whitespace is allowed. "``` js" mid-
    // fence is content, not the close. The bottom task is index 0.
    const markdown = ["```", "- [ ] inside", "``` js", "- [x] still-inside", "```", "- [ ] outside"].join("\n");
    const out = toggleTaskAt(markdown, 0);
    assert.equal(out, ["```", "- [ ] inside", "``` js", "- [x] still-inside", "```", "- [x] outside"].join("\n"));
  });

  it("a closer with only trailing whitespace IS a valid closer", () => {
    // Whitespace after the marker is fine for a closer.
    const markdown = ["```", "- [ ] inside", "```   ", "- [ ] outside"].join("\n");
    const out = toggleTaskAt(markdown, 0);
    assert.equal(out, ["```", "- [ ] inside", "```   ", "- [x] outside"].join("\n"));
  });

  it("recognises fences nested inside blockquotes", () => {
    // `> \`\`\`` opens a fenced block inside a blockquote. Without
    // blockquote stripping the walker would miscount the inner
    // `> - [ ] inside` as a real task; with the strip the only
    // counted task is the unquoted one outside.
    const markdown = ["> ```", "> - [ ] inside-fence", "> ```", "- [ ] outside"].join("\n");
    const out = toggleTaskAt(markdown, 0);
    assert.equal(out, ["> ```", "> - [ ] inside-fence", "> ```", "- [x] outside"].join("\n"));
  });

  it("blockquoted fence requires content indent ≤ 3 spaces", () => {
    // Inside a blockquote, the post-quote indent of `   ` ` ` ` ` is
    // 3 spaces — still a fence. (Compare with the next test for the
    // 4-space case which is NOT a fence.)
    const markdown = ["> ```", "> - [ ] in", "> ```", "- [ ] out"].join("\n");
    const out = toggleTaskAt(markdown, 0);
    assert.equal(out, ["> ```", "> - [ ] in", "> ```", "- [x] out"].join("\n"));
  });
});

describe("findTaskLines", () => {
  it("returns the 0-indexed line of every task", () => {
    const markdown = ["intro", "- [ ] zero", "skip", "- [x] one", "  * [ ] two-nested"].join("\n");
    assert.deepEqual(findTaskLines(markdown), [1, 3, 4]);
  });

  it("skips fenced code blocks", () => {
    const markdown = ["- [ ] real-0", "```", "- [ ] fake", "```", "- [ ] real-1"].join("\n");
    assert.deepEqual(findTaskLines(markdown), [0, 4]);
  });

  it("counts blockquoted tasks", () => {
    const markdown = ["- [ ] top", "> - [ ] quoted", "> > - [ ] nested-quoted"].join("\n");
    assert.deepEqual(findTaskLines(markdown), [0, 1, 2]);
  });

  it("returns an empty array when source has no tasks", () => {
    assert.deepEqual(findTaskLines("just text\n* regular bullet\n"), []);
  });

  // Documents the known limitation called out in the docstring: a
  // `- [ ] foo` line buried in a 4-space indented code block is still
  // counted by the source walker. The View layer cross-checks this
  // count against the rendered DOM and refuses to toggle on
  // disagreement, so the corruption never reaches disk.
  it("currently counts indented-code-block lines that LOOK like tasks (limitation)", () => {
    // Note this test pins existing behaviour, not desired behaviour.
    const markdown = "    - [ ] looks-like-task\n- [ ] real\n";
    assert.deepEqual(findTaskLines(markdown), [0, 1]);
  });
});

describe("makeTasksInteractive", () => {
  it("strips disabled and adds class on an unchecked task", () => {
    const before = '<li><input disabled="" type="checkbox"> Foo</li>';
    const after = '<li><input class="md-task" type="checkbox"> Foo</li>';
    assert.equal(makeTasksInteractive(before), after);
  });

  it("strips disabled and adds class on a checked task", () => {
    const before = '<li><input checked="" disabled="" type="checkbox"> Bar</li>';
    const after = '<li><input checked="" class="md-task" type="checkbox"> Bar</li>';
    assert.equal(makeTasksInteractive(before), after);
  });

  it("transforms multiple tasks in one HTML blob", () => {
    const before = '<ul><li><input disabled="" type="checkbox"> A</li><li><input checked="" disabled="" type="checkbox"> B</li></ul>';
    const after = '<ul><li><input class="md-task" type="checkbox"> A</li><li><input checked="" class="md-task" type="checkbox"> B</li></ul>';
    assert.equal(makeTasksInteractive(before), after);
  });

  it("leaves non-task inputs alone", () => {
    const html = '<input type="text" name="hi">';
    assert.equal(makeTasksInteractive(html), html);
  });

  it("is idempotent on already-transformed HTML", () => {
    const transformed = '<input class="md-task" type="checkbox">';
    assert.equal(makeTasksInteractive(transformed), transformed);
  });
});

// `makeTasksInteractive` is a regex over the literal string `marked`
// happens to emit today (`<input disabled="" type="checkbox">` and
// `<input checked="" disabled="" type="checkbox">`). If a future
// marked version reorders attributes, drops the empty-value form, or
// changes whitespace, the regex stops matching — and the breakage is
// silent at runtime (checkboxes render but never toggle). These tests
// exercise the actual marked output we ship against, so any such
// drift fails the test BEFORE it hits production.
describe("makeTasksInteractive — marked output compatibility lock", () => {
  it("strips disabled and tags both unchecked and checked tasks rendered by marked", () => {
    const markdown = "- [ ] todo\n- [x] done\n";
    const html = marked(markdown) as string;
    // Lock the marked-side assumption: both the unchecked and the
    // checked render forms must end with `disabled="" type="checkbox">`
    // — that's what the regex anchors on.
    assert.ok(html.includes('<input disabled="" type="checkbox">'), `marked unchecked form changed; got: ${html}`);
    assert.ok(html.includes('<input checked="" disabled="" type="checkbox">'), `marked checked form changed; got: ${html}`);

    const interactive = makeTasksInteractive(html);
    assert.ok(interactive.includes('<input class="md-task" type="checkbox">'), "unchecked input was not made interactive");
    assert.ok(interactive.includes('<input checked="" class="md-task" type="checkbox">'), "checked input was not made interactive");
    assert.ok(!interactive.includes("disabled"), "disabled attribute leaked through into the rewritten HTML");
  });

  it("works through marked's full pipeline: source → render → interactive → click finds the n-th input", () => {
    // End-to-end shape check: rendering 3 tasks must yield 3 inputs
    // tagged with `class="md-task"` so `querySelectorAll('input.md-task')`
    // in View.vue's click handler matches the source-side index.
    const markdown = "- [ ] zero\n- [x] one\n- [ ] two\n";
    const interactive = makeTasksInteractive(marked(markdown) as string);
    const matches = interactive.match(/<input[^>]*class="md-task"[^>]*>/g) ?? [];
    assert.equal(matches.length, 3, `expected 3 interactive inputs, got ${matches.length} in: ${interactive}`);
  });
});

// View.vue cross-checks `findTaskLines(source).length` against the
// rendered `input.md-task` count and refuses to toggle on mismatch
// (locked-in pluginMarkdown.taskCountMismatch error). These tests
// prove the hazard scenarios are real and detectable purely from
// `findTaskLines` + marked output — i.e. the cross-check has
// something to actually catch.
describe("findTaskLines vs marked render — cross-check justification", () => {
  it("an indented-code-block task line counts in source but renders as code (no input)", () => {
    // 4-space indent makes this content of an indented code block.
    // Source walker still sees a task line (documented limitation);
    // marked renders the line as `<pre><code>` with no checkbox.
    const markdown = "    - [ ] looks-like-task\n- [ ] real\n";
    const sourceCount = findTaskLines(markdown).length;
    const inputCount = (marked(markdown) as string).match(/<input[^>]*type="checkbox">/g)?.length ?? 0;
    assert.equal(sourceCount, 2, "source walker should count both lines");
    assert.equal(inputCount, 1, "marked should render only the un-indented task as a checkbox");
    // 2 vs 1 → mismatch → View.vue refuses click → no corruption.
  });

  it("counts agree on a clean document (no false-positive refuses)", () => {
    // The cross-check must not fire for the common case — otherwise
    // every click would refuse. Verify a normal mixed task / non-task
    // / blockquote / fence / ordered-list document agrees.
    const markdown = ["# Heading", "- [ ] a", "- [x] b", "Some prose.", "1. [ ] ordered", "> - [ ] quoted", "```", "- [ ] inside-fence", "```"].join("\n");
    const sourceCount = findTaskLines(markdown).length;
    const inputCount = (marked(markdown) as string).match(/<input[^>]*type="checkbox">/g)?.length ?? 0;
    assert.equal(sourceCount, inputCount, `mismatch on the happy path — source ${sourceCount}, dom ${inputCount}`);
    assert.equal(sourceCount, 4, "expected 4 real tasks (a, b, ordered, quoted)");
  });
});
