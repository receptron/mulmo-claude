// HTTP-level test for `POST /api/files/open` (#1985).
//
// Mounts the real files router on an Express app and hits the
// endpoint with a real HTTP request via fetch (same pattern as
// `test/server/test_csrfGuard_http.ts`). The earlier iteration of
// this file unit-tested `openInHostOs` by mutating
// `process.platform` and `process.env.PATH` — Codex correctly
// flagged that as unreliable under `tsx --test` parallelism, since
// a concurrent test file could observe the mutated globals mid-run.
// This file covers only the path-validation contract over real HTTP.
// The platform branch is NOT exercised here — running the real command
// opens Finder on the macOS CI runner. The argv per platform and the
// spawn handling are tested directly in test/routes/test_osOpen.ts.

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

const REL_TEST_DIR = "mc-test-open-in-os";

describe("POST /api/files/open (#1985)", () => {
  let fixture: AppFixture;
  let apiOpenRoute: string;

  before(async () => {
    // The workspace realpath is captured at module-load time inside
    // server/api/routes/files.ts. Create the workspace dir + the
    // test file BEFORE importing so the realpathSync call there
    // succeeds and points at the on-disk dir.
    const { workspacePath } = await import("../../server/workspace/workspace.js");
    mkdirSync(workspacePath, { recursive: true });
    const absDir = join(workspacePath, REL_TEST_DIR);
    mkdirSync(absDir, { recursive: true });
    const absFile = join(absDir, "sample.bin");
    writeFileSync(absFile, "not a real binary but has a body");

    const filesRoutesModule = await import("../../server/api/routes/files.js");
    const apiRoutesModule = await import("../../src/config/apiRoutes.js");
    apiOpenRoute = apiRoutesModule.API_ROUTES.files.open;

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
    const res = await fetch(`${fixture.baseUrl}${apiOpenRoute}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string };
    assert.match(body.error ?? "", /path required/);
  });

  it("returns 400 when the path escapes the workspace", async () => {
    const res = await fetch(`${fixture.baseUrl}${apiOpenRoute}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../../../etc/passwd" }),
    });
    assert.equal(res.status, 400);
  });
});
