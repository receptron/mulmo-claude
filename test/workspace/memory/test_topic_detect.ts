// Unit tests for `hasTopicFormat`. Pins the swap-window fix
// (#1076 review): the detector must return true while
// `swapStagingIntoMemory` has renamed `memory/` out of the way and
// is about to rename `memory.next/` into place. Without that, a
// request that hits the gap falls back to atomic-format writes
// inside the soon-to-be topic tree, and later topic-mode reads
// silently ignore the new file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { hasTopicFormat } from "../../../server/workspace/memory/topic-detect.js";

describe("memory/topic-detect — hasTopicFormat", () => {
  it("returns false on a fresh workspace with no memory tree at all", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-empty-"));
    try {
      assert.equal(hasTopicFormat(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns false when only the legacy `memory.md` is present (atomic format)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-atomic-"));
    try {
      await mkdir(path.join(root, "conversations", "memory"), { recursive: true });
      assert.equal(hasTopicFormat(root), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns true when a type subdir exists under `memory/` (post-swap)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-post-swap-"));
    try {
      await mkdir(path.join(root, "conversations", "memory", "interest"), { recursive: true });
      assert.equal(hasTopicFormat(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns true when only `memory.next/<type>` exists — covers the swap-in-progress window", async () => {
    // Reproduces the gap inside swapStagingIntoMemory:
    //   1. rename memory/ → memory.<ts>.backup
    //   2. <— hasTopicFormat must still return true here
    //   3. rename memory.next/ → memory/
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-swap-window-"));
    try {
      await mkdir(path.join(root, "conversations", "memory.next", "preference"), { recursive: true });
      assert.equal(hasTopicFormat(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns true when both `memory/<type>` and `memory.next/<type>` exist (mid-swap, before the dest rename)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mulmoclaude-topic-detect-both-"));
    try {
      await mkdir(path.join(root, "conversations", "memory", "interest"), { recursive: true });
      await mkdir(path.join(root, "conversations", "memory.next", "interest"), { recursive: true });
      assert.equal(hasTopicFormat(root), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
