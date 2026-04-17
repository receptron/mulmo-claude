import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// html-io imports workspacePath at module load. Override HOME so
// os.homedir() → temp root, then dynamic-import.
let tmpRoot: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

type HtmlIo = typeof import("../../../server/utils/files/html-io.js");
let mod: HtmlIo;

before(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "html-io-test-"));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpRoot;
  process.env.USERPROFILE = tmpRoot;
  fs.mkdirSync(path.join(tmpRoot, "mulmoclaude"), { recursive: true });
  mod = await import("../../../server/utils/files/html-io.js");
});

after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("readCurrentHtml / writeCurrentHtml", () => {
  it("returns null when no HTML has been generated", async () => {
    assert.equal(await mod.readCurrentHtml(), null);
  });

  it("round-trips HTML content", async () => {
    await mod.writeCurrentHtml("<h1>Hello</h1>");
    const html = await mod.readCurrentHtml();
    assert.equal(html, "<h1>Hello</h1>");
  });

  it("creates parent dir on first write", async () => {
    // writeCurrentHtml should not throw even with fresh workspace
    await mod.writeCurrentHtml("<p>test</p>");
    assert.equal(await mod.readCurrentHtml(), "<p>test</p>");
  });

  it("overwrites on second write", async () => {
    await mod.writeCurrentHtml("<p>first</p>");
    await mod.writeCurrentHtml("<p>second</p>");
    assert.equal(await mod.readCurrentHtml(), "<p>second</p>");
  });
});
