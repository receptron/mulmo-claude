import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveNewSessionRoleId,
  shouldReplaceHistory,
  isSessionEmpty,
  isSessionAlreadyDisplayed,
  isOnTargetSessionRoute,
  resolveResumeAction,
} from "../../../src/utils/session/sessionLifecycle.ts";

describe("resolveNewSessionRoleId", () => {
  it("uses the explicit role id when provided", () => {
    assert.equal(resolveNewSessionRoleId("editor", "general", ["general", "coder"]), "editor");
  });

  it("prefers the explicit id even when it is not in the known roles", () => {
    // createNewSession does not validate the id it is handed (comment on
    // startNewChatDraft) — the explicit id wins verbatim.
    assert.equal(resolveNewSessionRoleId("unknown", "general", ["general"]), "unknown");
  });

  it("keeps an explicit empty string (?? only falls through on undefined)", () => {
    // `?? ` triggers only on null/undefined, so an explicit "" is honoured
    // rather than falling back to the dropdown pick.
    assert.equal(resolveNewSessionRoleId("", "general", ["general"]), "");
  });

  it("falls back to the current dropdown role when no explicit id", () => {
    assert.equal(resolveNewSessionRoleId(undefined, "coder", ["general", "coder"]), "coder");
  });

  it("falls back to the first role when both explicit and current are empty", () => {
    assert.equal(resolveNewSessionRoleId(undefined, "", ["general", "coder"]), "general");
  });

  it("returns '' when explicit is undefined, current is empty, and no roles seeded", () => {
    assert.equal(resolveNewSessionRoleId(undefined, "", []), "");
  });
});

describe("shouldReplaceHistory", () => {
  it("replaces only when an empty session was removed AND on /chat", () => {
    assert.equal(shouldReplaceHistory(true, true), true);
  });

  it("pushes when nothing empty was removed, even on /chat", () => {
    assert.equal(shouldReplaceHistory(false, true), false);
  });

  it("pushes when off /chat, even after removing an empty session", () => {
    assert.equal(shouldReplaceHistory(true, false), false);
  });

  it("pushes when neither condition holds", () => {
    assert.equal(shouldReplaceHistory(false, false), false);
  });
});

describe("isSessionEmpty", () => {
  it("is true for a session with no tool results", () => {
    assert.equal(isSessionEmpty({ toolResults: [] }), true);
  });

  it("is false as soon as one result exists", () => {
    assert.equal(isSessionEmpty({ toolResults: [{}] }), false);
  });

  it("is false for many results", () => {
    assert.equal(isSessionEmpty({ toolResults: [{}, {}, {}] }), false);
  });
});

describe("isSessionAlreadyDisplayed", () => {
  it("is true only when id matches the displayed one AND it is in memory", () => {
    assert.equal(isSessionAlreadyDisplayed("s1", "s1", true), true);
  });

  it("is false when the id matches but it is not in memory", () => {
    assert.equal(isSessionAlreadyDisplayed("s1", "s1", false), false);
  });

  it("is false when a different session is displayed", () => {
    assert.equal(isSessionAlreadyDisplayed("s1", "s2", true), false);
  });

  it("is false off /chat where currentSessionId is empty", () => {
    // currentSessionId is "" on non-chat pages, so a history-panel click
    // there never matches and always navigates.
    assert.equal(isSessionAlreadyDisplayed("s1", "", true), false);
  });
});

describe("isOnTargetSessionRoute", () => {
  it("is true when on /chat and the URL already points at the target", () => {
    assert.equal(isOnTargetSessionRoute("s1", "s1", true), true);
  });

  it("is false when the URL points at a different session", () => {
    assert.equal(isOnTargetSessionRoute("s2", "s1", true), false);
  });

  it("is false when not on the chat route, even if ids match", () => {
    assert.equal(isOnTargetSessionRoute("s1", "s1", false), false);
  });

  it("is false when the route has no session id", () => {
    assert.equal(isOnTargetSessionRoute("", "s1", true), false);
  });
});

describe("resolveResumeAction", () => {
  it("creates a fresh session when there is no history", () => {
    assert.equal(resolveResumeAction(undefined, false), "create");
  });

  it("activates the top session in place when it is already in memory", () => {
    assert.equal(resolveResumeAction("s1", true), "activate");
  });

  it("loads the top session from the server when it is not in memory", () => {
    assert.equal(resolveResumeAction("s1", false), "load");
  });

  it("creates when the top id is an empty string (falsy)", () => {
    assert.equal(resolveResumeAction("", true), "create");
  });
});
