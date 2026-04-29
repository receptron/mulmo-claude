import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PUBSUB_CHANNELS, fileChannel, sessionChannel } from "../../src/config/pubsubChannels.js";

describe("sessionChannel", () => {
  it("prefixes the session id with `session.`", () => {
    assert.equal(sessionChannel("abc"), "session.abc");
  });

  it("passes the id through verbatim (no encoding / sanitisation)", () => {
    // chatSessionId is already filesystem-safe upstream; the
    // factory's job is strictly to prepend the prefix.
    assert.equal(sessionChannel("my-session-12345"), "session.my-session-12345");
    assert.equal(sessionChannel("telegram-999-1713100000"), "session.telegram-999-1713100000");
  });

  it("works on an empty id (produces the bare prefix)", () => {
    // Edge case — not something callers should rely on, but the
    // factory shouldn't surprise them with a throw.
    assert.equal(sessionChannel(""), "session.");
  });
});

describe("fileChannel", () => {
  it("prefixes the path with `file:` and uses POSIX separators", () => {
    assert.equal(fileChannel("artifacts/html/2026/04/foo.html"), "file:artifacts/html/2026/04/foo.html");
  });

  it("normalises backslashes to forward slashes (Windows-published, Linux-subscribed)", () => {
    assert.equal(fileChannel("artifacts\\html\\2026\\foo.html"), "file:artifacts/html/2026/foo.html");
  });

  it("collapses runs of separators so a sloppy caller can't drift the channel name", () => {
    // Publisher and subscriber both pass the same string through the
    // factory, so a literal "//" in either side would still match —
    // but the audit trail in logs is cleaner without doubles.
    assert.equal(fileChannel("artifacts//html///foo.html"), "file:artifacts/html/foo.html");
  });
});

describe("PUBSUB_CHANNELS", () => {
  it("exposes the sidebar-refresh notification channel", () => {
    assert.equal(PUBSUB_CHANNELS.sessions, "sessions");
  });

  it("exposes the debug heartbeat channel", () => {
    assert.equal(PUBSUB_CHANNELS.debugBeat, "debug.beat");
  });

  it("static channel names don't collide with the session. prefix", () => {
    // Defensive: if anyone adds a static channel called "session.X",
    // it could be confused for a per-session one on the subscriber
    // side. Keep them disjoint.
    for (const value of Object.values(PUBSUB_CHANNELS)) {
      assert.equal(value.startsWith("session."), false, `static channel "${value}" must not reuse the session. prefix`);
    }
  });
});
