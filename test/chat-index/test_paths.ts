// Unit tests for the pure path helpers in
// server/workspace/chat-index/paths.ts. These helpers compose
// workspace-relative paths and are used across chat-index modules.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  CHAT_DIR,
  INDEX_DIR,
  MANIFEST_FILE,
  chatDirFor,
  indexDirFor,
  sessionJsonlPathFor,
  sessionMetaPathFor,
  indexEntryPathFor,
  manifestPathFor,
} from "../../server/workspace/chat-index/paths.js";

// Use a platform-appropriate workspace root so path.join output
// matches on Windows (backslashes) as well as POSIX.
const workspace = path.join(path.sep, "tmp", "ws");

describe("constants", () => {
  it("exports expected directory and file name constants", () => {
    assert.equal(CHAT_DIR, "chat");
    assert.equal(INDEX_DIR, "index");
    assert.equal(MANIFEST_FILE, "manifest.json");
  });
});

describe("chatDirFor", () => {
  it("returns workspace/chat", () => {
    assert.equal(chatDirFor(workspace), path.join(workspace, "chat"));
  });
});

describe("indexDirFor", () => {
  it("returns workspace/chat/index", () => {
    assert.equal(indexDirFor(workspace), path.join(workspace, "chat", "index"));
  });
});

describe("sessionJsonlPathFor", () => {
  it("returns workspace/chat/<sessionId>.jsonl", () => {
    assert.equal(sessionJsonlPathFor(workspace, "sess-abc"), path.join(workspace, "chat", "sess-abc.jsonl"));
  });

  it("handles UUID-style session IDs", () => {
    const sessionId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    assert.equal(sessionJsonlPathFor(workspace, sessionId), path.join(workspace, "chat", `${sessionId}.jsonl`));
  });
});

describe("sessionMetaPathFor", () => {
  it("returns workspace/chat/<sessionId>.json", () => {
    assert.equal(sessionMetaPathFor(workspace, "sess-abc"), path.join(workspace, "chat", "sess-abc.json"));
  });
});

describe("indexEntryPathFor", () => {
  it("returns workspace/chat/index/<sessionId>.json", () => {
    assert.equal(indexEntryPathFor(workspace, "sess-abc"), path.join(workspace, "chat", "index", "sess-abc.json"));
  });
});

describe("manifestPathFor", () => {
  it("returns workspace/chat/index/manifest.json", () => {
    assert.equal(manifestPathFor(workspace), path.join(workspace, "chat", "index", "manifest.json"));
  });
});

describe("path consistency", () => {
  it("indexDirFor is a child of chatDirFor", () => {
    const chatDir = chatDirFor(workspace);
    const indexDir = indexDirFor(workspace);
    assert.ok(indexDir.startsWith(chatDir + path.sep));
  });

  it("manifestPathFor is inside indexDirFor", () => {
    const indexDir = indexDirFor(workspace);
    const manifest = manifestPathFor(workspace);
    assert.ok(manifest.startsWith(indexDir + path.sep));
  });

  it("indexEntryPathFor is inside indexDirFor", () => {
    const indexDir = indexDirFor(workspace);
    const entry = indexEntryPathFor(workspace, "x");
    assert.ok(entry.startsWith(indexDir + path.sep));
  });

  it("sessionJsonlPathFor is inside chatDirFor but not indexDirFor", () => {
    const chatDir = chatDirFor(workspace);
    const indexDir = indexDirFor(workspace);
    const jsonl = sessionJsonlPathFor(workspace, "x");
    assert.ok(jsonl.startsWith(chatDir + path.sep));
    assert.ok(!jsonl.startsWith(indexDir + path.sep));
  });

  it("sessionMetaPathFor is inside chatDirFor but not indexDirFor", () => {
    const chatDir = chatDirFor(workspace);
    const indexDir = indexDirFor(workspace);
    const meta = sessionMetaPathFor(workspace, "x");
    assert.ok(meta.startsWith(chatDir + path.sep));
    assert.ok(!meta.startsWith(indexDir + path.sep));
  });
});
