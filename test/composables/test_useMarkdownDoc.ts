// Composable: parses a reactive markdown ref into the canonical
// view used by every Vue component that displays markdown from
// disk (#895 PR A). Keeping this thin — the heavy lifting is in
// `parseFrontmatter`; the composable's job is reactivity + the
// ordered `fields` array for properties-panel rendering.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";
import { formatScalarField, useMarkdownDoc } from "../../src/composables/useMarkdownDoc.js";

describe("useMarkdownDoc", () => {
  it("derives meta + body + fields from a reactive markdown source", () => {
    const content = ref("---\ntitle: Hello\ntags: [a, b]\n---\n\nbody\n");
    const view = useMarkdownDoc(content);

    assert.equal(view.value.hasHeader, true);
    assert.equal(view.value.body, "body\n");
    assert.equal(view.value.meta.title, "Hello");
    assert.deepEqual(view.value.fields, [
      { key: "title", value: "Hello" },
      { key: "tags", value: ["a", "b"] },
    ]);
  });

  it("returns the empty state when content is null", () => {
    const content = ref<string | null>(null);
    const view = useMarkdownDoc(content);
    assert.equal(view.value.hasHeader, false);
    assert.equal(view.value.body, "");
    assert.deepEqual(view.value.fields, []);
  });

  it("returns the empty state when content is undefined", () => {
    const content = ref<string | undefined>(undefined);
    const view = useMarkdownDoc(content);
    assert.equal(view.value.hasHeader, false);
    assert.deepEqual(view.value.fields, []);
  });

  it("re-parses when the input ref changes (reactivity)", () => {
    const content = ref("plain body\n");
    const view = useMarkdownDoc(content);
    assert.equal(view.value.hasHeader, false);
    assert.deepEqual(view.value.fields, []);

    content.value = "---\nupdated: 2026-04-27\n---\nnew body\n";
    assert.equal(view.value.hasHeader, true);
    assert.equal(view.value.meta.updated, "2026-04-27");
    assert.equal(view.value.body, "new body\n");
  });

  it("returns body verbatim when no envelope is present", () => {
    const content = ref("# Heading\n\nbody without frontmatter\n");
    const view = useMarkdownDoc(content);
    assert.equal(view.value.hasHeader, false);
    assert.equal(view.value.body, "# Heading\n\nbody without frontmatter\n");
    assert.deepEqual(view.value.fields, []);
  });
});

// formatScalarField is the template helper that prevents nested
// frontmatter values from rendering as `[object Object]` (codex
// review iter-1 #902). It runs in template scope so it must
// handle every shape `unknown` can hold without throwing.
describe("formatScalarField", () => {
  it("renders strings, numbers, booleans via String()", () => {
    assert.equal(formatScalarField("hello"), "hello");
    assert.equal(formatScalarField(42), "42");
    assert.equal(formatScalarField(true), "true");
    assert.equal(formatScalarField(false), "false");
  });

  it("renders null and undefined as empty string", () => {
    assert.equal(formatScalarField(null), "");
    assert.equal(formatScalarField(undefined), "");
  });

  it("renders nested objects as compact JSON (not [object Object])", () => {
    assert.equal(formatScalarField({ a: 1, b: "two" }), '{"a":1,"b":"two"}');
  });

  it("falls back to String() for cyclic objects (no throw)", () => {
    // A cyclic object can't be JSON.stringify'd. The helper must
    // degrade gracefully so a template render doesn't crash the
    // properties panel.
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const out = formatScalarField(cyclic);
    assert.equal(typeof out, "string");
  });
});
