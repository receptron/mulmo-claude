// Regression test for the PPTX → PDF companion save path.
//
// `saveCompanion` writes a not-yet-existing file (the converted PDF)
// next to the original upload. It must NOT route that path through the
// realpath-based `safeResolve`, which ENOENTs on a missing leaf and
// surfaces as a misleading "path traversal rejected" — the bug that
// made every PPTX upload fail. These tests pin the working behaviour
// (companion lands on disk under the same partition) and that genuine
// traversal is still rejected.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { saveAttachment, saveCompanion } from "../../../server/utils/files/attachment-store.js";
import { WORKSPACE_PATHS } from "../../../server/workspace/paths.js";

const ONE_PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

describe("attachment-store — saveCompanion", () => {
  let savedDescriptor: PropertyDescriptor | undefined;
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), "attach-companion-test-"));
    savedDescriptor = Object.getOwnPropertyDescriptor(WORKSPACE_PATHS, "attachments");
    Object.defineProperty(WORKSPACE_PATHS, "attachments", {
      ...(savedDescriptor ?? { configurable: true }),
      value: path.join(workspaceRoot, "data/attachments"),
      configurable: true,
      enumerable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (savedDescriptor) Object.defineProperty(WORKSPACE_PATHS, "attachments", savedDescriptor);
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("writes a companion PDF alongside the original, reusing its id + partition", async () => {
    const original = await saveAttachment(ONE_PIXEL_PNG_BASE64, "application/pdf");
    const buf = Buffer.from("%PDF-1.4 fake companion");

    const companionPath = await saveCompanion(original.relativePath, buf, ".pdf");

    // Same directory + id prefix, only the extension differs.
    const dir = path.posix.dirname(original.relativePath);
    const base = path.posix.basename(original.relativePath, path.posix.extname(original.relativePath));
    assert.equal(companionPath, path.posix.join(dir, `${base}.pdf`));

    const absPath = path.join(workspaceRoot, companionPath);
    assert.ok(existsSync(absPath), "companion file should exist on disk");
    assert.deepEqual(readFileSync(absPath), buf);
  });

  it("rejects a traversal-shaped original path instead of escaping the root", async () => {
    await assert.rejects(() => saveCompanion("data/attachments/../../etc/passwd.pptx", Buffer.from("x"), ".pdf"), /path traversal rejected/);
  });
});
