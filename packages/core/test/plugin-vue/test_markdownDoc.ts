// The frontmatter → view transform and the scalar formatter shared by every markdown-
// from-disk view (#895 PR A, #2408). The pure functions carry the logic; useMarkdownDoc
// is a thin computed() wrapper over buildMarkdownDocView.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";
import { buildMarkdownDocView, formatScalarField, useMarkdownDoc } from "../../src/plugin-vue/index.ts";

describe("buildMarkdownDocView", () => {
  it("derives meta + body + ordered fields from a frontmatter envelope", () => {
    const view = buildMarkdownDocView("---\ntitle: Hello\ntags: [a, b]\n---\n\nbody\n");
    assert.equal(view.hasHeader, true);
    assert.equal(view.body, "body\n");
    assert.equal(view.meta.title, "Hello");
    assert.deepEqual(view.fields, [
      { key: "title", value: "Hello" },
      { key: "tags", value: ["a", "b"] },
    ]);
  });

  it("returns the empty state for an empty string", () => {
    const view = buildMarkdownDocView("");
    assert.equal(view.hasHeader, false);
    assert.equal(view.body, "");
    assert.deepEqual(view.fields, []);
  });

  it("returns body verbatim when no envelope is present", () => {
    const view = buildMarkdownDocView("# Heading\n\nbody without frontmatter\n");
    assert.equal(view.hasHeader, false);
    assert.equal(view.body, "# Heading\n\nbody without frontmatter\n");
    assert.deepEqual(view.fields, []);
  });
});

describe("useMarkdownDoc", () => {
  it("maps null/undefined content to the empty state", () => {
    const nullContent = ref<string | null>(null);
    assert.deepEqual(useMarkdownDoc(nullContent).value.fields, []);
    assert.equal(useMarkdownDoc(nullContent).value.hasHeader, false);

    const undefinedContent = ref<string | undefined>(undefined);
    assert.equal(useMarkdownDoc(undefinedContent).value.hasHeader, false);
  });

  it("re-parses when the input ref changes (reactivity)", () => {
    const content = ref("plain body\n");
    const view = useMarkdownDoc(content);
    assert.equal(view.value.hasHeader, false);

    content.value = "---\nupdated: 2026-04-27\n---\nnew body\n";
    assert.equal(view.value.hasHeader, true);
    assert.equal(view.value.meta.updated, "2026-04-27");
    assert.equal(view.value.body, "new body\n");
  });
});

// formatScalarField runs in template scope, so it must render every shape `unknown` can
// hold without throwing (codex review iter-1 #902). Silent-failure-prone → tested hard.
describe("formatScalarField", () => {
  it("renders strings verbatim and numbers/booleans/bigints via String()", () => {
    assert.equal(formatScalarField("hello"), "hello");
    assert.equal(formatScalarField(42), "42");
    assert.equal(formatScalarField(true), "true");
    assert.equal(formatScalarField(false), "false");
    assert.equal(formatScalarField(9007199254740993n), "9007199254740993");
  });

  it("renders null and undefined as empty string", () => {
    assert.equal(formatScalarField(null), "");
    assert.equal(formatScalarField(undefined), "");
  });

  it("renders nested objects and arrays as compact JSON (not [object Object])", () => {
    assert.equal(formatScalarField({ a: 1, b: "two" }), '{"a":1,"b":"two"}');
    assert.equal(formatScalarField([1, "x"]), '[1,"x"]');
  });

  it("falls back to a non-throwing tag for cyclic objects", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    assert.equal(formatScalarField(cyclic), "[object Object]");
  });
});
