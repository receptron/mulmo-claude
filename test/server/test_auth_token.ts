import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { __resetForTests, deleteTokenFile, generateAndWriteToken, getCurrentToken } from "../../server/api/auth/token.js";

let tmpDir = "";
let tokenPath = "";

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mulmo-token-test-"));
  tokenPath = path.join(tmpDir, ".session-token");
  __resetForTests();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateAndWriteToken", () => {
  it("returns a 64-character hex string (32 random bytes)", async () => {
    const token = await generateAndWriteToken(tokenPath);
    assert.equal(token.length, 64);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it("writes the token to the given path", async () => {
    const token = await generateAndWriteToken(tokenPath);
    const onDisk = fs.readFileSync(tokenPath, "utf-8");
    assert.equal(onDisk, token);
  });

  it("updates getCurrentToken() to return the new token", async () => {
    assert.equal(getCurrentToken(), null);
    const token = await generateAndWriteToken(tokenPath);
    assert.equal(getCurrentToken(), token);
  });

  it("rotates: subsequent calls produce a new token and overwrite the file", async () => {
    const first = await generateAndWriteToken(tokenPath);
    const second = await generateAndWriteToken(tokenPath);
    assert.notEqual(first, second);
    assert.equal(getCurrentToken(), second);
    assert.equal(fs.readFileSync(tokenPath, "utf-8"), second);
  });

  it("writes with mode 0600 on POSIX", async () => {
    if (process.platform === "win32") return; // chmod 0600 is a no-op on Windows
    await generateAndWriteToken(tokenPath);
    const mode = fs.statSync(tokenPath).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it("creates the parent directory if it doesn't exist", async () => {
    const nested = path.join(tmpDir, "nested", "deep", ".session-token");
    await generateAndWriteToken(nested);
    assert.ok(fs.existsSync(nested));
  });
});

describe("generateAndWriteToken — env override (#316)", () => {
  it("uses the override verbatim when non-empty", async () => {
    const override = "pinned-token-1234567890abcdef1234567890abcdef12";
    const token = await generateAndWriteToken(tokenPath, override);
    assert.equal(token, override);
    assert.equal(getCurrentToken(), override);
    assert.equal(fs.readFileSync(tokenPath, "utf-8"), override);
  });

  it("does not rotate — repeated calls with the same override return it each time", async () => {
    const override = "stable-token-abcdefabcdefabcdefabcdefabcdef";
    const first = await generateAndWriteToken(tokenPath, override);
    const second = await generateAndWriteToken(tokenPath, override);
    assert.equal(first, override);
    assert.equal(second, override);
  });

  it("treats empty string as no override (falls back to random)", async () => {
    const token = await generateAndWriteToken(tokenPath, "");
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.notEqual(token, "");
  });

  it("treats undefined as no override (falls back to random)", async () => {
    const token = await generateAndWriteToken(tokenPath, undefined);
    assert.match(token, /^[0-9a-f]{64}$/);
  });

  it("accepts a short override but still uses it (warning is logged, not an error)", async () => {
    const token = await generateAndWriteToken(tokenPath, "short");
    assert.equal(token, "short");
    assert.equal(getCurrentToken(), "short");
  });
});

describe("deleteTokenFile", () => {
  it("removes the token file", async () => {
    await generateAndWriteToken(tokenPath);
    assert.ok(fs.existsSync(tokenPath));
    await deleteTokenFile(tokenPath);
    assert.ok(!fs.existsSync(tokenPath));
  });

  it("is a no-op when the file is already missing", async () => {
    assert.ok(!fs.existsSync(tokenPath));
    await deleteTokenFile(tokenPath); // must not throw
    assert.ok(!fs.existsSync(tokenPath));
  });

  it("does not touch the in-memory token (caller's responsibility)", async () => {
    const token = await generateAndWriteToken(tokenPath);
    await deleteTokenFile(tokenPath);
    // Deletion is file-level cleanup only. The in-memory value stays
    // until the next generation — callers that care must stop
    // serving traffic first.
    assert.equal(getCurrentToken(), token);
  });
});

describe("getCurrentToken", () => {
  it("returns null before any token has been generated", () => {
    assert.equal(getCurrentToken(), null);
  });
});
