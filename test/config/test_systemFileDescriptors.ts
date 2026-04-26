import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { descriptorForPath, SYSTEM_FILE_DESCRIPTORS } from "../../src/config/systemFileDescriptors.js";

describe("descriptorForPath — exact matches", () => {
  it("returns the interests descriptor for config/interests.json", () => {
    const desc = descriptorForPath("config/interests.json");
    assert.equal(desc?.id, "interests");
    assert.equal(desc?.editPolicy, "agent-managed-but-hand-editable");
    assert.equal(desc?.schemaRef, "server/workspace/sources/interests.ts");
  });

  it("returns the mcp descriptor for config/mcp.json", () => {
    const desc = descriptorForPath("config/mcp.json");
    assert.equal(desc?.id, "mcp");
    assert.equal(desc?.editPolicy, "user-editable");
  });

  it("returns the wiki SCHEMA descriptor (fragile-format) for data/wiki/SCHEMA.md", () => {
    const desc = descriptorForPath("data/wiki/SCHEMA.md");
    assert.equal(desc?.id, "wikiSchema");
    assert.equal(desc?.editPolicy, "fragile-format");
  });

  it("returns the memory descriptor for conversations/memory.md", () => {
    const desc = descriptorForPath("conversations/memory.md");
    assert.equal(desc?.id, "memory");
  });
});

describe("descriptorForPath — pattern matches", () => {
  it("matches a role JSON file under config/roles/", () => {
    const desc = descriptorForPath("config/roles/general.json");
    assert.equal(desc?.id, "rolesJson");
  });

  it("matches a role Markdown file under config/roles/", () => {
    const desc = descriptorForPath("config/roles/general.md");
    assert.equal(desc?.id, "rolesMd");
  });

  it("matches a source feed Markdown file directly under data/sources/", () => {
    const desc = descriptorForPath("data/sources/hackernews.md");
    assert.equal(desc?.id, "sourceFeed");
  });

  it("matches per-source state JSON under data/sources/_state/", () => {
    const desc = descriptorForPath("data/sources/_state/hackernews.json");
    assert.equal(desc?.id, "sourceState");
    assert.equal(desc?.editPolicy, "ephemeral");
  });

  it("matches a daily journal markdown with the YYYY/MM/DD shape", () => {
    const desc = descriptorForPath("conversations/summaries/daily/2026/04/26.md");
    assert.equal(desc?.id, "journalDaily");
  });

  it("matches a topic journal markdown", () => {
    const desc = descriptorForPath("conversations/summaries/topics/llm-research.md");
    assert.equal(desc?.id, "journalTopic");
  });
});

describe("descriptorForPath — non-matches", () => {
  it("returns null for an arbitrary user-created markdown", () => {
    assert.equal(descriptorForPath("data/notes/random.md"), null);
  });

  it("returns null for an empty string", () => {
    assert.equal(descriptorForPath(""), null);
  });

  it("returns null for a partial-prefix path that should not match a pattern", () => {
    // Pattern guards against `_state` directory entries leaking into
    // the `sourceFeed` regex. _state/foo.json is its own descriptor;
    // the bare _state path does not match either.
    assert.equal(descriptorForPath("data/sources/_state/"), null);
  });

  it("does not match a malformed daily journal path (missing day)", () => {
    assert.equal(descriptorForPath("conversations/summaries/daily/2026/04/.md"), null);
  });

  it("does not match a path that is a prefix of an exact-match path", () => {
    assert.equal(descriptorForPath("config/interests"), null);
  });
});

describe("SYSTEM_FILE_DESCRIPTORS — invariants", () => {
  it("every descriptor id is unique (i18n keys are 1:1 with descriptors)", () => {
    const ids = SYSTEM_FILE_DESCRIPTORS.map((entry) => entry.descriptor.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, `duplicate descriptor ids: ${ids.join(", ")}`);
  });

  it("every exact entry uses a workspace-relative path (no leading slash)", () => {
    for (const entry of SYSTEM_FILE_DESCRIPTORS) {
      if (entry.kind === "exact") {
        assert.ok(!entry.path.startsWith("/"), `${entry.path} must be workspace-relative`);
      }
    }
  });
});
