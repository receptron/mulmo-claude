// Unit tests for buildMemoryContext / buildMemoryManagementSection
// format detection (#1070 PR-B).
//
// The same disk signal — the presence of a `<type>/` subdir under
// `conversations/memory/` — drives both the read context and the
// write instructions, so they always agree.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildMemoryContext, buildMemoryManagementSection } from "../../server/agent/prompt.js";

describe("memory/format-detect — atomic workspace", () => {
  let scoped: string;

  before(async () => {
    scoped = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mctx-atomic-"));
    // Atomic entry: flat file at the memory dir root.
    const memDir = path.join(scoped, "conversations", "memory");
    await mkdir(memDir, { recursive: true });
    await writeFile(path.join(memDir, "preference_yarn.md"), "---\nname: yarn\ndescription: npm 不可\ntype: preference\n---\n\nyarn 固定\n", "utf-8");
  });

  after(async () => {
    await rm(scoped, { recursive: true, force: true });
  });

  it("buildMemoryContext renders the atomic entry verbatim", () => {
    const out = buildMemoryContext(scoped);
    assert.match(out, /yarn 固定/);
  });

  it("buildMemoryManagementSection emits the atomic-format instructions", () => {
    const out = buildMemoryManagementSection(scoped);
    assert.match(out, /<type>_<short-slug>\.md/);
    assert.doesNotMatch(out, /<type>\/<topic>\.md/);
  });
});

describe("memory/format-detect — topic workspace", () => {
  let scoped: string;

  before(async () => {
    scoped = await mkdtemp(path.join(tmpdir(), "mulmoclaude-mctx-topic-"));
    // Topic-format file: `<type>/<topic>.md`. The presence of the
    // type subdir is enough to flip detection.
    const interestDir = path.join(scoped, "conversations", "memory", "interest");
    await mkdir(interestDir, { recursive: true });
    await writeFile(
      path.join(interestDir, "music.md"),
      [
        "---",
        "type: interest",
        "topic: music",
        "---",
        "",
        "# Music",
        "",
        "## Rock / Metal",
        "- Pantera, Metallica",
        "",
        "## Punk / Melodic",
        "- NOFX, Hi-STANDARD",
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  after(async () => {
    await rm(scoped, { recursive: true, force: true });
  });

  it("buildMemoryContext renders the topic file with its sections", () => {
    const out = buildMemoryContext(scoped);
    assert.match(out, /\[interest\] interest\/music\.md — Rock \/ Metal, Punk \/ Melodic/);
    assert.match(out, /Pantera, Metallica/);
  });

  it("buildMemoryContext skips both atomic-format files AND a stray legacy memory.md once topic format is active", async () => {
    // Three layers can coexist on disk during the transition:
    //   1) the new topic file (interest/music.md, set up in `before`)
    //   2) an atomic-format leftover at the memory root
    //   3) the legacy `conversations/memory.md` from #1029 PR-A
    // In topic mode the reader must surface (1) only; (2) and (3)
    // come along for the ride if a swap happened to land on top of
    // a partial atomic / legacy state. `should-not-leak` markers
    // double as prompt-injection canaries.
    const memDir = path.join(scoped, "conversations", "memory");
    await writeFile(
      path.join(memDir, "preference_obsolete.md"),
      "---\nname: obsolete\ndescription: stale\ntype: preference\n---\n\nshould-not-leak-from-atomic",
      "utf-8",
    );
    await writeFile(path.join(scoped, "conversations", "memory.md"), "## Stale\n- should-not-leak-from-legacy", "utf-8");

    const out = buildMemoryContext(scoped);
    assert.doesNotMatch(out, /should-not-leak-from-atomic/, "atomic file at memory root must not bleed into topic-mode prompt");
    assert.doesNotMatch(out, /should-not-leak-from-legacy/, "legacy memory.md must not bleed into topic-mode prompt");
    // The topic file's content is still visible.
    assert.match(out, /Pantera, Metallica/);
  });

  it("buildMemoryManagementSection emits the topic-format instructions", () => {
    const out = buildMemoryManagementSection(scoped);
    assert.match(out, /<type>\/<topic>\.md/);
    assert.match(out, /H2 sections/);
    assert.doesNotMatch(out, /<type>_<short-slug>\.md/);
  });

  it("buildMemoryManagementSection includes the proactive-recall guidance (#1035)", () => {
    // The recall paragraph turns the topic-mode prompt from
    // "write here when something is durable" into "AND read this
    // when answering". Without it, the agent has the index but no
    // explicit cue to consult it before responding.
    const out = buildMemoryManagementSection(scoped);
    assert.match(out, /Using memory proactively/);
    assert.match(out, /Before answering/);
    // Recall must NOT instruct the agent to narrate its memory use.
    assert.match(out, /Do NOT announce/);
  });
});
