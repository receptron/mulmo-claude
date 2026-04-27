// Tests for findLatestDaily — the directory walk that backs the
// top-bar "today's journal" shortcut (#876).
//
// The function walks `conversations/summaries/daily/YYYY/MM/DD.md`
// deepest-first with backtrack. Each test sets up a tmpdir
// workspace with a controlled layout and asserts the chosen file.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { findLatestDaily } from "../../server/workspace/journal/latestDaily.js";

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(path.join(tmpdir(), "latest-daily-"));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function dailyDir(): string {
  return path.join(workspaceRoot, "conversations", "summaries", "daily");
}

function placeDaily(year: string, month: string, day: string): void {
  const dir = path.join(dailyDir(), year, month);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${day}.md`), `# ${year}-${month}-${day}\n`);
}

describe("findLatestDaily", () => {
  it("returns null when daily/ does not exist", async () => {
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result, null);
  });

  it("returns null when daily/ exists but has no files", async () => {
    mkdirSync(dailyDir(), { recursive: true });
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result, null);
  });

  it("returns the only existing daily file", async () => {
    placeDaily("2026", "04", "26");
    const result = await findLatestDaily(workspaceRoot);
    assert.deepEqual(result, {
      path: "conversations/summaries/daily/2026/04/26.md",
      isoDate: "2026-04-26",
    });
  });

  it("picks the latest year when multiple years exist", async () => {
    placeDaily("2025", "12", "31");
    placeDaily("2026", "04", "26");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.isoDate, "2026-04-26");
  });

  it("picks the latest month within a year", async () => {
    placeDaily("2026", "01", "15");
    placeDaily("2026", "04", "26");
    placeDaily("2026", "03", "10");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.isoDate, "2026-04-26");
  });

  it("picks the latest day within a month", async () => {
    placeDaily("2026", "04", "01");
    placeDaily("2026", "04", "26");
    placeDaily("2026", "04", "15");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.isoDate, "2026-04-26");
  });

  it("backtracks through an empty newer-month dir to the prior month", async () => {
    // 2026/05/ exists but has no files (e.g. journal mkdir-ed it
    // ahead of writing). Must fall back to 2026/04.
    mkdirSync(path.join(dailyDir(), "2026", "05"), { recursive: true });
    placeDaily("2026", "04", "26");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.isoDate, "2026-04-26");
  });

  it("backtracks through an empty newer-year dir to the prior year", async () => {
    mkdirSync(path.join(dailyDir(), "2027"), { recursive: true });
    placeDaily("2026", "04", "26");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.isoDate, "2026-04-26");
  });

  it("ignores non-numeric directory names at the year level", async () => {
    mkdirSync(path.join(dailyDir(), "archive"), { recursive: true });
    placeDaily("2026", "04", "26");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.isoDate, "2026-04-26");
  });

  it("ignores non-numeric files at the day level (e.g. .DS_Store, summary.txt)", async () => {
    placeDaily("2026", "04", "26");
    writeFileSync(path.join(dailyDir(), "2026", "04", ".DS_Store"), "");
    writeFileSync(path.join(dailyDir(), "2026", "04", "notes.md"), "");
    writeFileSync(path.join(dailyDir(), "2026", "04", "summary.txt"), "");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.isoDate, "2026-04-26");
  });

  it("ignores 1-digit day filenames (only DD.md is valid)", async () => {
    // The journal always writes zero-padded YYYY-MM-DD, so 4.md
    // would be a foreign artifact and should be skipped.
    placeDaily("2026", "04", "26");
    writeFileSync(path.join(dailyDir(), "2026", "04", "9.md"), "");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.isoDate, "2026-04-26");
  });

  it("returns a posix-style relative path even when the workspace path uses native separators", async () => {
    placeDaily("2026", "04", "26");
    const result = await findLatestDaily(workspaceRoot);
    assert.equal(result?.path, "conversations/summaries/daily/2026/04/26.md");
    // Specifically, no backslashes — needed by the FilesView URL builder.
    assert.equal(result?.path.includes("\\"), false);
  });
});
