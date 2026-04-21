import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";
import { useContentDisplay } from "../../src/composables/useContentDisplay.ts";
import type { FileContent } from "../../src/composables/useFileSelection.ts";

function textContent(path: string, body: string): FileContent {
  return {
    kind: "text",
    path,
    content: body,
    size: body.length,
    modifiedMs: 0,
  };
}

describe("useContentDisplay — type flags", () => {
  it("isMarkdown is true for .md and .markdown (case-insensitive)", () => {
    for (const path of ["a.md", "a.MD", "a.Markdown", "deep/path/README.md"]) {
      const selectedPath = ref<string | null>(path);
      const content = ref<FileContent | null>(null);
      const { isMarkdown } = useContentDisplay(selectedPath, content);
      assert.equal(isMarkdown.value, true, `path=${path}`);
    }
  });

  it("isMarkdown is false for null, unrelated extensions", () => {
    for (const path of [null, "a.mdx", "a.txt", "a"]) {
      const selectedPath = ref<string | null>(path);
      const content = ref<FileContent | null>(null);
      const { isMarkdown } = useContentDisplay(selectedPath, content);
      assert.equal(isMarkdown.value, false, `path=${JSON.stringify(path)}`);
    }
  });

  it("isHtml covers .html and .htm", () => {
    const selected = ref<string | null>("x.html");
    const content = ref<FileContent | null>(null);
    assert.equal(useContentDisplay(selected, content).isHtml.value, true);
    selected.value = "x.htm";
    assert.equal(useContentDisplay(selected, content).isHtml.value, true);
    selected.value = "x.xhtml";
    assert.equal(useContentDisplay(selected, content).isHtml.value, false);
  });

  it("isJson only matches .json (not .jsonl)", () => {
    const selected = ref<string | null>("x.json");
    const content = ref<FileContent | null>(null);
    assert.equal(useContentDisplay(selected, content).isJson.value, true);
    selected.value = "x.jsonl";
    assert.equal(useContentDisplay(selected, content).isJson.value, false);
  });

  it("isJsonl covers .jsonl and .ndjson", () => {
    const selected = ref<string | null>("x.jsonl");
    const content = ref<FileContent | null>(null);
    assert.equal(useContentDisplay(selected, content).isJsonl.value, true);
    selected.value = "x.ndjson";
    assert.equal(useContentDisplay(selected, content).isJsonl.value, true);
    selected.value = "x.json";
    assert.equal(useContentDisplay(selected, content).isJsonl.value, false);
  });
});

describe("useContentDisplay — sandboxedHtml", () => {
  it("wraps HTML content with CSP meta when selection is .html + text kind", () => {
    const selectedPath = ref<string | null>("a.html");
    const content = ref<FileContent | null>(textContent("a.html", "<p>hi</p>"));
    const { sandboxedHtml } = useContentDisplay(selectedPath, content);
    assert.ok(sandboxedHtml.value.length > 0);
    assert.ok(sandboxedHtml.value.includes("<p>hi</p>"));
    assert.match(sandboxedHtml.value, /Content-Security-Policy/i);
  });

  it("is empty string when selection isn't HTML", () => {
    const selectedPath = ref<string | null>("a.md");
    const content = ref<FileContent | null>(textContent("a.md", "# hi"));
    const { sandboxedHtml } = useContentDisplay(selectedPath, content);
    assert.equal(sandboxedHtml.value, "");
  });

  it("is empty string when content is null", () => {
    const selectedPath = ref<string | null>("a.html");
    const content = ref<FileContent | null>(null);
    const { sandboxedHtml } = useContentDisplay(selectedPath, content);
    assert.equal(sandboxedHtml.value, "");
  });
});

describe("useContentDisplay — JSON guards (regression: #517 review)", () => {
  it("jsonTokens is [] for non-JSON text files (no eager parsing)", () => {
    const selectedPath = ref<string | null>("a.md");
    const content = ref<FileContent | null>(
      textContent("a.md", "not json at all ["),
    );
    const { jsonTokens } = useContentDisplay(selectedPath, content);
    // Without the isJson guard, prettyJson/tokenizeJson would run
    // on arbitrary markdown. Guard must short-circuit first.
    assert.deepEqual(jsonTokens.value, []);
  });

  it("jsonlLines is [] for non-JSONL text files", () => {
    const selectedPath = ref<string | null>("a.md");
    const content = ref<FileContent | null>(textContent("a.md", "body"));
    const { jsonlLines } = useContentDisplay(selectedPath, content);
    assert.deepEqual(jsonlLines.value, []);
  });

  it("jsonTokens has content for actual .json files", () => {
    const selectedPath = ref<string | null>("a.json");
    const content = ref<FileContent | null>(textContent("a.json", '{"k":1}'));
    const { jsonTokens } = useContentDisplay(selectedPath, content);
    assert.ok(jsonTokens.value.length > 0);
  });

  it("jsonlLines has lines for actual .jsonl files", () => {
    const selectedPath = ref<string | null>("a.jsonl");
    const content = ref<FileContent | null>(
      textContent("a.jsonl", '{"k":1}\n{"k":2}'),
    );
    const { jsonlLines } = useContentDisplay(selectedPath, content);
    assert.equal(jsonlLines.value.length, 2);
  });
});

describe("useContentDisplay — mdFrontmatter", () => {
  it("returns parsed frontmatter for markdown with `---` header", () => {
    const selectedPath = ref<string | null>("a.md");
    const content = ref<FileContent | null>(
      textContent("a.md", "---\ntitle: Hello\n---\nbody"),
    );
    const { mdFrontmatter } = useContentDisplay(selectedPath, content);
    assert.ok(mdFrontmatter.value);
    assert.equal(mdFrontmatter.value.body, "body");
    const titleField = mdFrontmatter.value.fields.find(
      (field) => field.key === "title",
    );
    assert.ok(titleField);
    assert.equal(titleField.value, "Hello");
  });

  it("is null for non-markdown files even if the text starts with ---", () => {
    const selectedPath = ref<string | null>("a.txt");
    const content = ref<FileContent | null>(
      textContent("a.txt", "---\ntitle: x\n---\nbody"),
    );
    const { mdFrontmatter } = useContentDisplay(selectedPath, content);
    assert.equal(mdFrontmatter.value, null);
  });

  it("is null when content is null", () => {
    const selectedPath = ref<string | null>("a.md");
    const content = ref<FileContent | null>(null);
    const { mdFrontmatter } = useContentDisplay(selectedPath, content);
    assert.equal(mdFrontmatter.value, null);
  });
});
