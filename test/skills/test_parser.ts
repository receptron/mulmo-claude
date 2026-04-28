import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSkillFrontmatter } from "../../server/workspace/skills/parser.js";

describe("parseSkillFrontmatter", () => {
  it("parses a standard SKILL.md with description + body", () => {
    const raw = `---
description: Enable CI for a repository
---

## Steps

1. Add workflow file
2. Open a PR
`;
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    assert.equal(parsed.description, "Enable CI for a repository");
    assert.match(parsed.body, /^## Steps/);
    assert.match(parsed.body, /Open a PR/);
  });

  it("tolerates CRLF line endings", () => {
    const raw = "---\r\ndescription: Hi\r\n---\r\n\r\nbody here\r\n";
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    assert.equal(parsed.description, "Hi");
    assert.match(parsed.body, /body here/);
  });

  it("strips quotes from a quoted description", () => {
    const raw = `---
description: "Colons: are : fine"
---

body
`;
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    assert.equal(parsed.description, "Colons: are : fine");
  });

  it("handles single-quoted descriptions", () => {
    const raw = `---
description: 'single quoted'
---
body`;
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    assert.equal(parsed.description, "single quoted");
  });

  it("keeps the first colon's value when the value itself contains colons", () => {
    const raw = `---
description: See helps/wiki.md for details
---
`;
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    assert.equal(parsed.description, "See helps/wiki.md for details");
  });

  it("skips unrelated keys inside the frontmatter", () => {
    const raw = `---
name: ci_enable
tags: [ci, github]
description: Enable CI
version: 1
---

body
`;
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    assert.equal(parsed.description, "Enable CI");
  });

  it("returns null when there is no frontmatter fence", () => {
    const raw = "# Just a heading\n\nNo frontmatter here.\n";
    assert.equal(parseSkillFrontmatter(raw), null);
  });

  it("returns null when the closing fence is missing", () => {
    const raw = `---
description: Never closed

Body but no closer.
`;
    assert.equal(parseSkillFrontmatter(raw), null);
  });

  it("returns null when no description key is present", () => {
    const raw = `---
name: has-no-description
---

Body
`;
    assert.equal(parseSkillFrontmatter(raw), null);
  });

  it("returns an empty body when the file is frontmatter-only", () => {
    const raw = `---
description: Metadata only
---
`;
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    assert.equal(parsed.body, "");
  });

  it("trims leading blank lines and trailing whitespace from body", () => {
    const raw = `---
description: Keep the middle
---



  # Heading

  content

`;
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    assert.equal(parsed.body.startsWith("  # Heading"), true);
    assert.equal(parsed.body.endsWith("content"), true);
  });

  it("returns null for empty input", () => {
    assert.equal(parseSkillFrontmatter(""), null);
  });

  it("is not fooled by a `---` that appears inside the body", () => {
    const raw = `---
description: Main
---

some content
---
followed by a divider in the body
`;
    const parsed = parseSkillFrontmatter(raw);
    assert.ok(parsed);
    // The frontmatter closed at the expected spot; body contains the
    // stray divider verbatim.
    assert.equal(parsed.description, "Main");
    assert.match(parsed.body, /followed by a divider/);
  });
});
