import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendEntries,
  parseMemory,
  renderMemory,
  type MemoryEntry,
} from "../../server/journal/memory.js";

describe("parseMemory", () => {
  it("returns empty sections + preamble for the stub form", () => {
    const raw = `# Memory\n\nDistilled facts about you and your work.\n`;
    const parsed = parseMemory(raw);
    assert.equal(parsed.preamble.includes("# Memory"), true);
    assert.deepEqual(parsed.sections.user, []);
    assert.deepEqual(parsed.sections.feedback, []);
    assert.deepEqual(parsed.sections.project, []);
    assert.deepEqual(parsed.sections.reference, []);
    assert.equal(parsed.trailing, "");
  });

  it("captures bullets per section in source order", () => {
    const raw = `# Memory

## User

- macOS + Docker
- OSS maintainer

## Feedback

- Prefer yarn

## Project

- mulmoclaude phase 1
`;
    const parsed = parseMemory(raw);
    assert.deepEqual(parsed.sections.user, [
      "macOS + Docker",
      "OSS maintainer",
    ]);
    assert.deepEqual(parsed.sections.feedback, ["Prefer yarn"]);
    assert.deepEqual(parsed.sections.project, ["mulmoclaude phase 1"]);
    assert.deepEqual(parsed.sections.reference, []);
  });

  it("accepts sections out of canonical order (rendered output sorts them)", () => {
    const raw = `# Memory

## Project

- foo

## User

- bar
`;
    const parsed = parseMemory(raw);
    assert.deepEqual(parsed.sections.user, ["bar"]);
    assert.deepEqual(parsed.sections.project, ["foo"]);
  });

  it("preserves preamble verbatim (apart from trailing blank lines)", () => {
    const raw = `# Memory

> Important: this file is auto-distilled. Edit carefully.

## User

- a
`;
    const parsed = parseMemory(raw);
    assert.match(parsed.preamble, /Important: this file/);
    assert.deepEqual(parsed.sections.user, ["a"]);
  });

  it("preserves trailing content when an unknown ## heading appears after sections", () => {
    const raw = `# Memory

## User

- known section

## Customs

Hand-written prose I want to keep.

- and a bullet
`;
    const parsed = parseMemory(raw);
    assert.deepEqual(parsed.sections.user, ["known section"]);
    assert.match(parsed.trailing, /## Customs/);
    assert.match(parsed.trailing, /Hand-written prose/);
  });

  it("handles CRLF line endings", () => {
    const raw = "# Memory\r\n\r\n## User\r\n\r\n- macOS\r\n";
    const parsed = parseMemory(raw);
    assert.deepEqual(parsed.sections.user, ["macOS"]);
  });

  it("ignores non-bullet content inside a known section", () => {
    const raw = `# Memory

## User

Some prose Claude tried to write here.

- the bullet survives
`;
    const parsed = parseMemory(raw);
    assert.deepEqual(parsed.sections.user, ["the bullet survives"]);
  });

  it("recognises both `-` and `*` bullet markers", () => {
    const raw = `# Memory

## User

- dash
* asterisk
`;
    const parsed = parseMemory(raw);
    assert.deepEqual(parsed.sections.user, ["dash", "asterisk"]);
  });

  it("returns empty arrays for an empty input", () => {
    const parsed = parseMemory("");
    assert.deepEqual(parsed.sections.user, []);
    assert.equal(parsed.preamble, "");
    assert.equal(parsed.trailing, "");
  });
});

describe("appendEntries", () => {
  function freshParsed() {
    return parseMemory(`# Memory\n\n## User\n\n- macOS\n`);
  }

  it("adds a new entry to the right section", () => {
    const entries: MemoryEntry[] = [
      { type: "user", body: "OSS maintainer at receptron" },
    ];
    const next = appendEntries(freshParsed(), entries);
    assert.deepEqual(next.sections.user, [
      "macOS",
      "OSS maintainer at receptron",
    ]);
  });

  it("creates a section for an entry whose type isn't yet present", () => {
    const entries: MemoryEntry[] = [
      { type: "feedback", body: "Prefer yarn over npm" },
    ];
    const next = appendEntries(freshParsed(), entries);
    assert.deepEqual(next.sections.feedback, ["Prefer yarn over npm"]);
  });

  it("skips an entry whose body is already a substring of an existing bullet", () => {
    const parsed = parseMemory(
      `# Memory\n\n## User\n\n- macOS + Docker Desktop environment\n`,
    );
    const entries: MemoryEntry[] = [{ type: "user", body: "macOS + Docker" }];
    const next = appendEntries(parsed, entries);
    assert.equal(next.sections.user.length, 1);
  });

  it("dedup is case-insensitive", () => {
    const parsed = parseMemory(
      `# Memory\n\n## Feedback\n\n- Prefer YARN over npm\n`,
    );
    const entries: MemoryEntry[] = [
      { type: "feedback", body: "prefer yarn over npm" },
    ];
    const next = appendEntries(parsed, entries);
    assert.equal(next.sections.feedback.length, 1);
  });

  it("returns the input untouched when entries is empty", () => {
    const parsed = freshParsed();
    const result = appendEntries(parsed, []);
    assert.equal(result, parsed);
  });

  it("ignores entries whose body is empty / whitespace-only", () => {
    const entries: MemoryEntry[] = [
      { type: "user", body: "   " },
      { type: "user", body: "" },
      { type: "user", body: "real one" },
    ];
    const next = appendEntries(freshParsed(), entries);
    assert.deepEqual(next.sections.user, ["macOS", "real one"]);
  });

  it("does not mutate the input parsed object", () => {
    const parsed = freshParsed();
    const before = [...parsed.sections.user];
    appendEntries(parsed, [{ type: "user", body: "added" }]);
    assert.deepEqual(parsed.sections.user, before);
  });
});

describe("renderMemory", () => {
  it("emits sections in canonical order regardless of input order", () => {
    const parsed = parseMemory(
      `# Memory\n\n## Project\n\n- p\n\n## User\n\n- u\n`,
    );
    const out = renderMemory(parsed);
    const userIdx = out.indexOf("## User");
    const projectIdx = out.indexOf("## Project");
    assert.ok(userIdx >= 0 && projectIdx >= 0);
    assert.ok(userIdx < projectIdx, "User must come before Project");
  });

  it("omits empty sections", () => {
    const parsed = parseMemory(`# Memory\n\n## User\n\n- only one\n`);
    const out = renderMemory(parsed);
    assert.doesNotMatch(out, /## Feedback/);
    assert.doesNotMatch(out, /## Project/);
    assert.doesNotMatch(out, /## Reference/);
    assert.match(out, /## User/);
  });

  it("renders bullets with `- ` prefix and ends with a single newline", () => {
    const parsed = parseMemory(`# Memory\n\n## User\n\n- a\n- b\n`);
    const out = renderMemory(parsed);
    assert.match(out, /## User\n\n- a\n- b/);
    assert.equal(out.endsWith("\n"), true);
    assert.equal(out.endsWith("\n\n"), false);
  });

  it("preserves trailing custom content when re-rendering", () => {
    const parsed = parseMemory(
      `# Memory\n\n## User\n\n- a\n\n## Customs\n\nhand-written\n`,
    );
    const out = renderMemory(parsed);
    assert.match(out, /## User\n\n- a/);
    assert.match(out, /## Customs/);
    assert.match(out, /hand-written/);
  });

  it("round-trips a stub file (renders preamble alone)", () => {
    const raw = `# Memory\n\nDistilled facts about you and your work.\n`;
    const out = renderMemory(parseMemory(raw));
    assert.match(out, /# Memory/);
    assert.match(out, /Distilled facts/);
  });

  it("integrates parse → append → render round-trip", () => {
    const raw = `# Memory\n\n## User\n\n- macOS\n`;
    const parsed = parseMemory(raw);
    const next = appendEntries(parsed, [
      { type: "feedback", body: "Prefer yarn" },
      { type: "user", body: "OSS maintainer" },
    ]);
    const out = renderMemory(next);
    assert.match(out, /## User\n\n- macOS\n- OSS maintainer/);
    assert.match(out, /## Feedback\n\n- Prefer yarn/);
  });
});
