// Route-level contract for POST /api/files/upload (#2270). The filename rules
// themselves live in test_upload_name.ts; what matters here is the endpoint's
// security/correctness envelope: what it refuses, and that a name collision
// renames instead of clobbering. `writeUploadWithRename` takes its resolver and
// writer as seams so these run without touching the real workspace.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateUploadBody, writeUploadWithRename, type UploadWriteDeps } from "../../../server/api/routes/files.js";

const PNG_DATA_URL = "data:image/png;base64,aGVsbG8=";

function resolveOk(relPath: string): ReturnType<UploadWriteDeps["resolve"]> {
  return Promise.resolve({ ok: true as const, absPath: `/ws/${relPath}`, workspaceRoot: "/ws" });
}

function eexist(): Error & { code: string } {
  return Object.assign(new Error("file exists"), { code: "EEXIST" });
}

describe("validateUploadBody", () => {
  it("accepts a well-formed body and decodes the bytes", () => {
    const result = validateUploadBody({ dir: "data", filename: "photo.png", dataUrl: PNG_DATA_URL });
    assert.ok(result.ok);
    assert.equal(result.safeName, "photo.png");
    assert.equal(result.bytes.toString("utf8"), "hello");
  });

  it("strips a traversal in the filename down to its last segment", () => {
    const result = validateUploadBody({ dir: "data", filename: "../../etc/passwd", dataUrl: PNG_DATA_URL });
    assert.ok(result.ok);
    assert.equal(result.safeName, "passwd");
  });

  it("refuses an executable extension", () => {
    const result = validateUploadBody({ dir: "data", filename: "payload.exe", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
    assert.match(result.message, /not allowed/i);
  });

  it("refuses an executable extension regardless of case", () => {
    const result = validateUploadBody({ dir: "data", filename: "payload.ExE", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
  });

  // Regression: on Windows `payload.exe.` is written as `payload.exe`, but
  // `path.extname` on the raw name reports `"."` — the blocklist would miss it
  // unless the trailing dot is stripped before the check.
  it("refuses an executable extension hidden behind a trailing dot", () => {
    const result = validateUploadBody({ dir: "data", filename: "payload.exe.", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
    assert.match(result.message, /not allowed/i);
  });

  it("refuses a payload over the size cap", () => {
    // 33 MB of base64 decodes to > 32 MB.
    const oversized = `data:application/octet-stream;base64,${"A".repeat(45 * 1024 * 1024)}`;
    const result = validateUploadBody({ dir: "data", filename: "big.bin", dataUrl: oversized });
    assert.ok(!result.ok);
    assert.match(result.message, /limit/i);
  });

  // The tree hides the drop affordance on reference roots, but that's UI only —
  // the endpoint has to refuse them so a direct POST can't write into a
  // read-only mount.
  it("refuses an upload targeting a reference root", () => {
    const result = validateUploadBody({ dir: "@ref/docs", filename: "photo.png", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
    assert.match(result.message, /read-only/i);
  });

  it("refuses a nested path inside a reference root", () => {
    const result = validateUploadBody({ dir: "@ref/docs/sub", filename: "photo.png", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
  });

  // The bare segment isn't caught by the `@ref/` prefix test, but writing into
  // it yields `@ref/<file>`, which the other file APIs read back as a
  // reference path — ambiguous and unreachable.
  it("refuses the bare `@ref` directory", () => {
    const result = validateUploadBody({ dir: "@ref", filename: "photo.png", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
    assert.match(result.message, /read-only/i);
  });

  it("refuses `@ref` reached via a non-normalised path", () => {
    const result = validateUploadBody({ dir: "./@ref", filename: "photo.png", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
  });

  // Host-independence: `path.normalize` would rewrite this to "@ref\docs" on
  // Windows and the "@ref/" prefix test would miss it, so the guard has to
  // compare on a POSIX-shaped path. Asserted on every platform.
  it("refuses a reference root written with backslashes", () => {
    const result = validateUploadBody({ dir: "@ref\\docs", filename: "photo.png", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
    assert.match(result.message, /read-only/i);
  });

  it("refuses a non-data: URL", () => {
    const result = validateUploadBody({ dir: "data", filename: "photo.png", dataUrl: "https://example.com/photo.png" });
    assert.ok(!result.ok);
    assert.match(result.message, /data:/);
  });

  it("refuses a missing field", () => {
    const result = validateUploadBody({ dir: "data", filename: "photo.png" });
    assert.ok(!result.ok);
  });

  it("refuses a filename that sanitizes away to nothing", () => {
    const result = validateUploadBody({ dir: "data", filename: "..", dataUrl: PNG_DATA_URL });
    assert.ok(!result.ok);
    assert.match(result.message, /filename/i);
  });
});

describe("writeUploadWithRename", () => {
  it("writes under the target dir on the happy path", async () => {
    const written: string[] = [];
    const deps: UploadWriteDeps = {
      resolve: resolveOk,
      write: async (absPath) => {
        written.push(absPath);
      },
    };
    const result = await writeUploadWithRename("data", "photo.png", Buffer.from("x"), deps);
    assert.ok(result.ok);
    assert.equal(result.relPath, "data/photo.png");
    assert.deepEqual(written, ["/ws/data/photo.png"]);
  });

  it("auto-renames instead of overwriting when the name is taken", async () => {
    const attempted: string[] = [];
    const deps: UploadWriteDeps = {
      resolve: resolveOk,
      write: async (absPath) => {
        attempted.push(absPath);
        if (absPath === "/ws/data/photo.png") throw eexist();
      },
    };
    const result = await writeUploadWithRename("data", "photo.png", Buffer.from("x"), deps);
    assert.ok(result.ok);
    assert.equal(result.relPath, "data/photo (1).png");
    assert.deepEqual(attempted, ["/ws/data/photo.png", "/ws/data/photo (1).png"]);
  });

  it("keeps incrementing past several taken names", async () => {
    const taken = new Set(["/ws/data/photo.png", "/ws/data/photo (1).png", "/ws/data/photo (2).png"]);
    const deps: UploadWriteDeps = {
      resolve: resolveOk,
      write: async (absPath) => {
        if (taken.has(absPath)) throw eexist();
      },
    };
    const result = await writeUploadWithRename("data", "photo.png", Buffer.from("x"), deps);
    assert.ok(result.ok);
    assert.equal(result.relPath, "data/photo (3).png");
  });

  it("surfaces a containment rejection instead of writing", async () => {
    let wrote = false;
    const deps: UploadWriteDeps = {
      resolve: () => Promise.resolve({ ok: false as const, status: 400 as const, message: "Path outside workspace" }),
      write: async () => {
        wrote = true;
      },
    };
    const result = await writeUploadWithRename("../escape", "photo.png", Buffer.from("x"), deps);
    assert.ok(!result.ok);
    assert.equal(result.status, 400);
    assert.equal(wrote, false);
  });

  it("re-checks containment on every rename candidate, not just the first", async () => {
    const resolved: string[] = [];
    const deps: UploadWriteDeps = {
      resolve: (relPath) => {
        resolved.push(relPath);
        // The retry candidate is the one that fails containment.
        if (relPath.includes("(1)")) return Promise.resolve({ ok: false as const, status: 400 as const, message: "Path outside workspace" });
        return resolveOk(relPath);
      },
      write: async () => {
        throw eexist();
      },
    };
    const result = await writeUploadWithRename("data", "photo.png", Buffer.from("x"), deps);
    assert.ok(!result.ok);
    assert.deepEqual(resolved, ["data/photo.png", "data/photo (1).png"]);
  });

  it("stops on a non-EEXIST write failure rather than renaming around it", async () => {
    const deps: UploadWriteDeps = {
      resolve: resolveOk,
      write: async () => {
        throw new Error("disk on fire");
      },
    };
    const result = await writeUploadWithRename("data", "photo.png", Buffer.from("x"), deps);
    assert.ok(!result.ok);
    assert.equal(result.status, 500);
  });
});
