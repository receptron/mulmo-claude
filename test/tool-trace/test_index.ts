import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "fs/promises";
import { randomBytes } from "crypto";
import os from "os";
import path from "path";
import { createArgsCache, recordToolEvent, type RecordToolEventDeps } from "../../server/workspace/tool-trace/index.js";

const FIXED_NOW = new Date("2026-04-13T05:18:47.123Z");
const SID = "a821d112";

interface Harness {
  deps: RecordToolEventDeps;
  readJsonl: () => Promise<string>;
  savedSearches: { workspaceRoot: string; query: string }[];
}

async function makeHarness(workspaceRoot: string): Promise<Harness> {
  const resultsFilePath = path.join(workspaceRoot, "chat", `${SID}.jsonl`);
  // `appendFile` will create the dir's parent only if it exists; make
  // it explicit here so the first append doesn't ENOENT.
  const fs = await import("node:fs/promises");
  await fs.mkdir(path.dirname(resultsFilePath), { recursive: true });

  const savedSearches: { workspaceRoot: string; query: string }[] = [];
  const deps: RecordToolEventDeps = {
    workspaceRoot,
    chatSessionId: SID,
    resultsFilePath,
    argsCache: createArgsCache(),
    now: () => FIXED_NOW,
    saveSearch: async (inputs) => {
      savedSearches.push({
        workspaceRoot: inputs.workspaceRoot,
        query: inputs.query,
      });
      return `conversations/searches/2026-04-13/${inputs.query.replace(/\s+/g, "-")}-test0001.md`;
    },
  };

  return {
    deps,
    readJsonl: () => readFile(resultsFilePath, "utf-8"),
    savedSearches,
  };
}

function readJsonlLines(content: string): Record<string, unknown>[] {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("recordToolEvent", () => {
  let workspaceRoot: string;

  before(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "tool-trace-drv-"));
  });

  after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  // Isolate each test with its own harness so argsCache / jsonl don't
  // leak between cases.
  let harness: Harness;
  beforeEach(async () => {
    // Crypto-grade random keeps sonarjs/pseudo-random happy;
    // uniqueness only matters so each case gets its own jsonl dir.
    const subdir = path.join(workspaceRoot, `case-${randomBytes(4).toString("hex")}`);
    harness = await makeHarness(subdir);
  });

  it("writes a tool_call record and caches args", async () => {
    await recordToolEvent(
      {
        type: "tool_call",
        toolUseId: "u1",
        toolName: "Bash",
        args: { command: "ls" },
      },
      harness.deps,
    );
    const lines = readJsonlLines(await harness.readJsonl());
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, "tool_call");
    assert.equal(lines[0].toolName, "Bash");
    assert.deepEqual(lines[0].args, { command: "ls" });
    assert.equal(harness.deps.argsCache.size, 1);
  });

  it("matching tool_call_result for WebSearch writes a pointer record", async () => {
    await recordToolEvent(
      {
        type: "tool_call",
        toolUseId: "u-ws",
        toolName: "WebSearch",
        args: { query: "foo bar" },
      },
      harness.deps,
    );
    await recordToolEvent(
      {
        type: "tool_call_result",
        toolUseId: "u-ws",
        content: "top result body",
      },
      harness.deps,
    );
    const lines = readJsonlLines(await harness.readJsonl());
    const resultLine = lines.find((line) => line.type === "tool_call_result");
    assert.ok(resultLine);
    assert.ok(String(resultLine?.contentRef).startsWith("conversations/searches/2026-04-13/"));
    assert.equal(resultLine?.content, undefined);
    assert.equal(harness.savedSearches.length, 1);
    assert.equal(harness.savedSearches[0].query, "foo bar");
  });

  it("Read tool_call_result records a pointer to args.file_path", async () => {
    await recordToolEvent(
      {
        type: "tool_call",
        toolUseId: "u-read",
        toolName: "Read",
        args: { file_path: "wiki/pages/foo.md" },
      },
      harness.deps,
    );
    await recordToolEvent(
      {
        type: "tool_call_result",
        toolUseId: "u-read",
        content: "file content bytes",
      },
      harness.deps,
    );
    const lines = readJsonlLines(await harness.readJsonl());
    const resultLine = lines.find((line) => line.type === "tool_call_result");
    assert.equal(resultLine?.contentRef, "wiki/pages/foo.md");
    assert.equal(resultLine?.content, undefined);
  });

  it("Bash small output is inlined, not truncated", async () => {
    await recordToolEvent(
      {
        type: "tool_call",
        toolUseId: "u-bash",
        toolName: "Bash",
        args: { command: "echo hi" },
      },
      harness.deps,
    );
    await recordToolEvent({ type: "tool_call_result", toolUseId: "u-bash", content: "hi" }, harness.deps);
    const lines = readJsonlLines(await harness.readJsonl());
    const resultLine = lines.find((line) => line.type === "tool_call_result");
    assert.equal(resultLine?.content, "hi");
    assert.equal(resultLine?.truncated, false);
  });

  it("releases the args cache entry after the matching result", async () => {
    await recordToolEvent(
      {
        type: "tool_call",
        toolUseId: "u-x",
        toolName: "Bash",
        args: { command: "ls" },
      },
      harness.deps,
    );
    await recordToolEvent({ type: "tool_call_result", toolUseId: "u-x", content: "ok" }, harness.deps);
    assert.equal(harness.deps.argsCache.size, 0);
  });

  it("orphan tool_call_result (no prior call) still writes a best-effort inline record", async () => {
    await recordToolEvent(
      {
        type: "tool_call_result",
        toolUseId: "u-orphan",
        content: "mystery output",
      },
      harness.deps,
    );
    const lines = readJsonlLines(await harness.readJsonl());
    assert.equal(lines.length, 1);
    assert.equal(lines[0].type, "tool_call_result");
    assert.equal(lines[0].content, "mystery output");
    assert.equal(lines[0].toolName, "");
  });

  it("saveSearch throwing falls back to inline content (never kills the turn)", async () => {
    const failingDeps: RecordToolEventDeps = {
      ...harness.deps,
      saveSearch: async () => {
        throw new Error("disk full");
      },
    };
    await recordToolEvent(
      {
        type: "tool_call",
        toolUseId: "u-ws2",
        toolName: "WebSearch",
        args: { query: "fallback" },
      },
      failingDeps,
    );
    await recordToolEvent(
      {
        type: "tool_call_result",
        toolUseId: "u-ws2",
        content: "raw result",
      },
      failingDeps,
    );
    const lines = readJsonlLines(await harness.readJsonl());
    const resultLine = lines.find((line) => line.type === "tool_call_result");
    assert.equal(resultLine?.content, "raw result");
    assert.equal(resultLine?.contentRef, undefined);
  });
});
