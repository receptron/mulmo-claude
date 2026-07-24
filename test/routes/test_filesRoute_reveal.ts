// HTTP-level test for `POST /api/files/reveal` (#1985 follow-up).
//
// Mirrors test_filesRoute_open.ts: the reveal route's path-validation
// contract over real HTTP. The platform branch (which runs `open -R` and
// opens Finder on macOS) is tested via an injected spawner in
// test/routes/test_osOpen.ts, not by firing the real command here.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

interface AppFixture {
  baseUrl: string;
  close: () => Promise<void>;
}

const REL_TEST_DIR = "mc-test-reveal-in-os";

describe("POST /api/files/reveal (#1985)", () => {
  let fixture: AppFixture;
  let apiRevealRoute: string;

  before(async () => {
    const { workspacePath } = await import("../../server/workspace/workspace.js");
    mkdirSync(workspacePath, { recursive: true });
    const absDir = join(workspacePath, REL_TEST_DIR);
    mkdirSync(absDir, { recursive: true });
    const absFile = join(absDir, "sample.bin");
    writeFileSync(absFile, "not a real binary but has a body");

    const filesRoutesModule = await import("../../server/api/routes/files.js");
    const apiRoutesModule = await import("../../src/config/apiRoutes.js");
    apiRevealRoute = apiRoutesModule.API_ROUTES.files.reveal;

    const app = express();
    app.use(express.json());
    app.use(filesRoutesModule.default);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    fixture = {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
  });

  after(async () => {
    const { workspacePath } = await import("../../server/workspace/workspace.js");
    rmSync(join(workspacePath, REL_TEST_DIR), { recursive: true, force: true });
    await fixture.close();
  });

  it("returns 400 when the body carries no path", async () => {
    const res = await fetch(`${fixture.baseUrl}${apiRevealRoute}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /path required/);
  });

  it("returns 400 when the path escapes the workspace", async () => {
    const res = await fetch(`${fixture.baseUrl}${apiRevealRoute}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../../../etc/passwd" }),
    });
    assert.equal(res.status, 400);
  });
});
