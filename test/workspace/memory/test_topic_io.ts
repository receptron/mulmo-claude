// Unit tests for topic-based memory IO (#1070 PR-A).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  formatIndexLine,
  loadAllTopicFiles,
  loadAllTopicFilesSync,
  regenerateTopicIndex,
  topicMemoryIndexPath,
  topicMemoryRoot,
  writeTopicFile,
} from "../../../server/workspace/memory/topic-io.js";
import type { TopicMemoryFile } from "../../../server/workspace/memory/topic-types.js";

describe("memory/topic-io — write + read round-trip", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-io-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("writes a file under <type>/<topic>.md and reads it back with parsed sections", async () => {
    const file: TopicMemoryFile = {
      type: "interest",
      topic: "music",
      body: ["# Music", "", "## Rock / Metal", "- Pantera, Metallica", "", "## Punk / Melodic", "- NOFX, Hi-STANDARD"].join("\n"),
      sections: [],
    };
    const writtenRel = await writeTopicFile(workspaceRoot, file);
    assert.equal(writtenRel, "conversations/memory/interest/music.md");

    const all = await loadAllTopicFiles(workspaceRoot);
    assert.equal(all.length, 1);
    const [loaded] = all;
    assert.equal(loaded.type, "interest");
    assert.equal(loaded.topic, "music");
    assert.deepEqual(loaded.sections, ["Rock / Metal", "Punk / Melodic"]);
    assert.match(loaded.body, /Pantera/);
  });

  it("sync loader returns the same shape as the async loader", () => {
    const sync = loadAllTopicFilesSync(workspaceRoot);
    assert.equal(sync.length, 1);
    assert.equal(sync[0].topic, "music");
  });

  it("rejects an unsafe topic slug rather than escaping the type subdir", async () => {
    const malicious: TopicMemoryFile = {
      type: "fact",
      topic: "../../../etc/passwd",
      body: "# evil",
      sections: [],
    };
    await assert.rejects(() => writeTopicFile(workspaceRoot, malicious), /unsafe topic slug/);
  });
});

describe("memory/topic-io — reader tolerance", () => {
  let scoped: string;

  before(async () => {
    scoped = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-io-tol-"));
  });

  after(async () => {
    await rm(scoped, { recursive: true, force: true });
  });

  it("skips files whose frontmatter type does not match the directory", async () => {
    const root = topicMemoryRoot(scoped);
    await mkdir(path.join(root, "interest"), { recursive: true });
    await writeFile(path.join(root, "interest", "music.md"), "---\ntype: fact\ntopic: music\n---\n\n# Music", "utf-8");
    const all = await loadAllTopicFiles(scoped);
    assert.deepEqual(all, []);
  });

  it("skips MEMORY.md and dotfiles inside type subdirs", async () => {
    const root = topicMemoryRoot(scoped);
    await mkdir(path.join(root, "interest"), { recursive: true });
    await writeFile(path.join(root, "interest", "MEMORY.md"), "# index", "utf-8");
    await writeFile(path.join(root, "interest", ".scratch.md"), "# noise", "utf-8");
    await writeFile(path.join(root, "interest", "art.md"), "---\ntype: interest\ntopic: art\n---\n\n# Art\n\n- Impressionism", "utf-8");
    const all = await loadAllTopicFiles(scoped);
    assert.equal(all.length, 1);
    assert.equal(all[0].topic, "art");
  });

  it("returns empty when the memory dir does not exist", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-io-empty-"));
    try {
      assert.deepEqual(await loadAllTopicFiles(fresh), []);
      assert.deepEqual(loadAllTopicFilesSync(fresh), []);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});

describe("memory/topic-io — regenerateTopicIndex", () => {
  let scoped: string;

  before(async () => {
    scoped = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-io-idx-"));
    await writeTopicFile(scoped, {
      type: "interest",
      topic: "music",
      body: ["# Music", "", "## Rock / Metal", "- Pantera", "", "## Punk / Melodic", "- NOFX"].join("\n"),
      sections: [],
    });
    await writeTopicFile(scoped, {
      type: "preference",
      topic: "dev",
      body: ["# Dev", "", "## Tooling", "- yarn"].join("\n"),
      sections: [],
    });
    await writeTopicFile(scoped, {
      type: "fact",
      topic: "travel",
      body: ["# Travel", "", "- Egypt"].join("\n"),
      sections: [],
    });
  });

  after(async () => {
    await rm(scoped, { recursive: true, force: true });
  });

  it("emits a markdown index sorted by type then by topic, with H2 csv per file", async () => {
    await regenerateTopicIndex(scoped);
    const content = await readFile(topicMemoryIndexPath(scoped), "utf-8");
    assert.match(content, /## preference/);
    assert.match(content, /## interest/);
    assert.match(content, /## fact/);
    assert.match(content, /preference\/dev\.md — Tooling/);
    assert.match(content, /interest\/music\.md — Rock \/ Metal, Punk \/ Melodic/);
    assert.match(content, /fact\/travel\.md$/m);
    // preference must appear before interest must appear before fact.
    const prefIdx = content.indexOf("## preference");
    const intIdx = content.indexOf("## interest");
    const factIdx = content.indexOf("## fact");
    assert.ok(prefIdx < intIdx && intIdx < factIdx, "type sections sorted preference / interest / fact");
  });
});

describe("memory/topic-io — formatIndexLine", () => {
  it("omits the H2 csv when there are no sections", () => {
    const file: TopicMemoryFile = {
      type: "fact",
      topic: "travel",
      body: "",
      sections: [],
    };
    assert.equal(formatIndexLine(file), "- fact/travel.md");
  });
});
