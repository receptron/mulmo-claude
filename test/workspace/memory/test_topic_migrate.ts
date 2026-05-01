// Unit tests for atomic-to-topic staging migration (#1070 PR-A).
//
// We exercise the orchestrator with a deterministic stub clusterer
// so the test never touches Claude / network.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { writeMemoryEntry } from "../../../server/workspace/memory/io.js";
import { clusterAtomicIntoStaging, topicStagingPath } from "../../../server/workspace/memory/topic-migrate.js";
import type { MemoryClusterer } from "../../../server/workspace/memory/topic-cluster.js";

const stubClusterer: MemoryClusterer = async () => ({
  preference: [{ topic: "dev", unsectionedBullets: ["uses yarn (npm not allowed)"] }],
  interest: [
    {
      topic: "music",
      sections: [
        { heading: "Rock / Metal", bullets: ["likes Pantera", "Metallica"] },
        { heading: "Punk / Melodic", bullets: ["NOFX, Hi-STANDARD"] },
      ],
    },
  ],
  fact: [{ topic: "travel", unsectionedBullets: ["wants to visit Egypt"] }],
  reference: [],
});

describe("memory/topic-migrate — happy path", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-"));
    // Seed a few atomic entries to migrate from.
    await writeMemoryEntry(workspaceRoot, {
      name: "uses yarn",
      description: "npm not allowed",
      type: "preference",
      body: "uses yarn (npm not allowed)",
      slug: "preference_yarn",
    });
    await writeMemoryEntry(workspaceRoot, {
      name: "Pantera",
      description: "metal",
      type: "interest",
      body: "likes Pantera",
      slug: "interest_pantera",
    });
    await writeMemoryEntry(workspaceRoot, {
      name: "Metallica",
      description: "metal",
      type: "interest",
      body: "Metallica",
      slug: "interest_metallica",
    });
    await writeMemoryEntry(workspaceRoot, {
      name: "NOFX",
      description: "punk",
      type: "interest",
      body: "NOFX, Hi-STANDARD",
      slug: "interest_nofx",
    });
    await writeMemoryEntry(workspaceRoot, {
      name: "Egypt trip",
      description: "wants",
      type: "fact",
      body: "wants to visit Egypt",
      slug: "fact_egypt",
    });
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it("writes the cluster output to a staging dir without touching the atomic source", async () => {
    const result = await clusterAtomicIntoStaging(workspaceRoot, stubClusterer);
    assert.equal(result.noop, false);
    assert.equal(result.inputCount, 5);
    assert.equal(result.topicCounts.preference, 1);
    assert.equal(result.topicCounts.interest, 1);
    assert.equal(result.topicCounts.fact, 1);
    assert.equal(result.topicCounts.reference, 0);
    assert.equal(result.bulletsLost, 0);
    assert.equal(result.stagingPath, topicStagingPath(workspaceRoot));

    // The atomic source remains in place — the swap helper is what
    // the user runs after reviewing.
    const atomicStat = await stat(path.join(workspaceRoot, "conversations", "memory", "interest_pantera.md"));
    assert.ok(atomicStat.isFile());

    // Staging holds the new layout.
    const musicPath = path.join(result.stagingPath, "interest", "music.md");
    const musicContent = await readFile(musicPath, "utf-8");
    assert.match(musicContent, /^---\ntype: interest\ntopic: music\n---/);
    assert.match(musicContent, /## Rock \/ Metal/);
    assert.match(musicContent, /## Punk \/ Melodic/);
    assert.match(musicContent, /likes Pantera/);

    // Index reflects the staging.
    const indexContent = await readFile(path.join(result.stagingPath, "MEMORY.md"), "utf-8");
    assert.match(indexContent, /## preference/);
    assert.match(indexContent, /interest\/music\.md — Rock \/ Metal, Punk \/ Melodic/);
    assert.match(indexContent, /fact\/travel\.md/);
  });
});

describe("memory/topic-migrate — edge cases", () => {
  it("returns noop when there are no atomic entries", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-empty-"));
    try {
      const result = await clusterAtomicIntoStaging(fresh, stubClusterer);
      assert.equal(result.noop, true);
      assert.equal(result.inputCount, 0);
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("counts bullets lost when the cluster output is missing entries", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-loss-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      await writeMemoryEntry(fresh, {
        name: "emacs",
        description: "editor",
        type: "preference",
        body: "emacs",
        slug: "preference_emacs",
      });
      const partial: MemoryClusterer = async () => ({
        preference: [{ topic: "dev", unsectionedBullets: ["yarn"] }],
        interest: [],
        fact: [],
        reference: [],
      });
      const result = await clusterAtomicIntoStaging(fresh, partial);
      assert.equal(result.inputCount, 2);
      assert.equal(result.bulletsLost, 1);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("returns a partial result when the clusterer returns null", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-null-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      const nullClusterer: MemoryClusterer = async () => null;
      const result = await clusterAtomicIntoStaging(fresh, nullClusterer);
      assert.equal(result.noop, true);
      assert.equal(result.inputCount, 1);
      const stagingExists = await stat(topicStagingPath(fresh)).catch(() => null);
      assert.equal(stagingExists, null);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("removes any stale staging dir when the clusterer fails (does not leave the prior tree promotable)", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-stale-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "yarn",
        description: "npm 不可",
        type: "preference",
        body: "yarn",
        slug: "preference_yarn",
      });
      // Pre-seed a stale staging dir to simulate a prior successful
      // run that should NOT survive a subsequent failed cluster.
      const stagingPath = topicStagingPath(fresh);
      await mkdir(path.join(stagingPath, "preference"), { recursive: true });
      await writeFile(path.join(stagingPath, "preference", "old.md"), "---\ntype: preference\ntopic: old\n---\n\n# Old\n\n- old fact", "utf-8");
      await writeFile(path.join(stagingPath, "MEMORY.md"), "# Memory Index\n\n## preference\n\n- preference/old.md\n", "utf-8");

      const failingClusterer: MemoryClusterer = async () => {
        throw new Error("cluster boom");
      };
      const result = await clusterAtomicIntoStaging(fresh, failingClusterer);
      assert.equal(result.inputCount, 1);
      // No staging dir at all — caller can detect the failure by
      // asking for the staging path and getting ENOENT.
      const stagingExists = await stat(stagingPath).catch(() => null);
      assert.equal(stagingExists, null, "stale staging must not survive a failed cluster");
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("resolves duplicate-slug collisions instead of silently overwriting", async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-dup-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "Pantera",
        description: "metal",
        type: "interest",
        body: "Pantera",
        slug: "interest_pantera",
      });
      await writeMemoryEntry(fresh, {
        name: "NOFX",
        description: "punk",
        type: "interest",
        body: "NOFX",
        slug: "interest_nofx",
      });
      // The clusterer emits TWO topics that both want to be `music`.
      // The migration must keep both bullets — the second gets a
      // `-2` suffix.
      const collidingClusterer: MemoryClusterer = async () => ({
        preference: [],
        interest: [
          { topic: "music", unsectionedBullets: ["Pantera"] },
          { topic: "music", unsectionedBullets: ["NOFX"] },
        ],
        fact: [],
        reference: [],
      });
      const result = await clusterAtomicIntoStaging(fresh, collidingClusterer);
      assert.equal(result.topicCounts.interest, 2);

      const first = await readFile(path.join(result.stagingPath, "interest", "music.md"), "utf-8");
      const second = await readFile(path.join(result.stagingPath, "interest", "music-2.md"), "utf-8");
      assert.match(first, /Pantera/);
      assert.match(second, /NOFX/);
      // The colliding file's frontmatter records the suffixed slug
      // so the reader's "directory must match topic" rule still
      // holds.
      assert.match(second, /^---\ntype: interest\ntopic: music-2\n---/);

      const indexContent = await readFile(path.join(result.stagingPath, "MEMORY.md"), "utf-8");
      assert.match(indexContent, /interest\/music\.md/);
      assert.match(indexContent, /interest\/music-2\.md/);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("keeps colliding slugs at MAX length within the safety cap (suffix trims the base)", async () => {
    // Boundary case the iter-2 review caught: a clusterer returns two
    // topics that both hit the 60-char slug cap. The naive
    // `${base}-2` would produce a 62-char filename and trip
    // isSafeTopicSlug; the writer must trim the base so the suffixed
    // result still fits.
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-cap-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "x",
        description: "y",
        type: "interest",
        body: "x",
        slug: "interest_x",
      });
      const sixty = "a".repeat(60); // exactly MAX_TOPIC_SLUG_LENGTH
      const collidingClusterer: MemoryClusterer = async () => ({
        preference: [],
        interest: [
          { topic: sixty, unsectionedBullets: ["first"] },
          { topic: sixty, unsectionedBullets: ["second"] },
        ],
        fact: [],
        reference: [],
      });
      const result = await clusterAtomicIntoStaging(fresh, collidingClusterer);
      assert.equal(result.topicCounts.interest, 2);

      const interestDir = path.join(result.stagingPath, "interest");
      const files = (await readFile(path.join(result.stagingPath, "MEMORY.md"), "utf-8")).split("\n").filter((line) => line.startsWith("- interest/"));
      assert.equal(files.length, 2);
      // Every link in the index points to a real file with a slug
      // that passes the safety cap (≤ 60 chars).
      for (const line of files) {
        const match = /interest\/([^.]+)\.md/.exec(line);
        assert.ok(match, `line should reference a real file: ${line}`);
        const [, slug] = match;
        assert.ok(slug.length <= 60, `slug "${slug}" exceeds the 60-char cap`);
        const filePath = path.join(interestDir, `${slug}.md`);
        const content = await readFile(filePath, "utf-8");
        // Frontmatter `topic` matches the (suffixed, trimmed) slug.
        assert.match(content, new RegExp(`^---\\ntype: interest\\ntopic: ${slug}\\n---`));
      }
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("emits an index that reflects only successfully-written topics (not the cluster map)", async () => {
    // Inject a clusterer that emits one topic with content, plus one
    // topic that we ALSO write the same slug for — the second one
    // gets the `-2` suffix and is also in the index. This is the
    // direct output-shape test: index size matches files-on-disk.
    const fresh = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-mig-idx-"));
    try {
      await writeMemoryEntry(fresh, {
        name: "x",
        description: "y",
        type: "preference",
        body: "x",
        slug: "preference_x",
      });
      const clusterer: MemoryClusterer = async () => ({
        preference: [{ topic: "dev", unsectionedBullets: ["x"] }],
        interest: [],
        fact: [],
        reference: [],
      });
      const result = await clusterAtomicIntoStaging(fresh, clusterer);
      const indexContent = await readFile(path.join(result.stagingPath, "MEMORY.md"), "utf-8");
      // Exactly the topics we wrote — no broken links.
      const linkMatches = indexContent.match(/\.md/g) ?? [];
      assert.equal(linkMatches.length, 1);
      assert.match(indexContent, /preference\/dev\.md/);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
