import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCommandHandler } from "../src/commands.ts";
import type { TransportChatState } from "../src/chat-state.ts";
import type { SessionSummary } from "../src/types.ts";

const roles = [
  { id: "general", name: "General" },
  { id: "office", name: "Office" },
];

function makeState(
  overrides?: Partial<TransportChatState>,
): TransportChatState {
  return {
    externalChatId: "test-chat",
    sessionId: "sess-1",
    roleId: "general",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const mockSessions: SessionSummary[] = [
  {
    id: "s1",
    roleId: "general",
    preview: "First session",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "s2",
    roleId: "office",
    preview: "Second session",
    updatedAt: new Date().toISOString(),
  },
  {
    id: "s3",
    roleId: "general",
    preview: "Third session",
    updatedAt: new Date().toISOString(),
  },
];

const mockMessages = [
  { source: "user", text: "Hello" },
  { source: "assistant", text: "Hi there!" },
  { source: "user", text: "What is 2+2?" },
  { source: "assistant", text: "4" },
  { source: "user", text: "Thanks" },
  { source: "assistant", text: "You're welcome" },
];

describe("/sessions command", () => {
  it("lists sessions with page info", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listSessions: async ({ limit, offset }) => ({
        sessions: mockSessions.slice(offset, offset + limit),
        total: mockSessions.length,
      }),
    });
    const result = await handler("/sessions", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("First session"));
    assert.ok(result.reply.includes("total 3"));
  });

  it("returns not available when listSessions is not provided", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/sessions", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("not available"));
  });
});

describe("/switch command", () => {
  it("switches to a session from the list", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async (_t, _c, sessionId) => makeState({ sessionId }),
      listSessions: async ({ limit, offset }) => ({
        sessions: mockSessions.slice(offset, offset + limit),
        total: mockSessions.length,
      }),
    });
    // First call /sessions to populate cache
    await handler("/sessions", "telegram", makeState());
    // Then switch
    const result = await handler("/switch 2", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Second session"));
    assert.ok(result.nextState);
  });

  it("treats non-digit argument as session ID (not found)", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/switch abc", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("not found"));
  });

  it("per-chat cache isolation", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async (_t, _c, sessionId) => makeState({ sessionId }),
      listSessions: async ({ limit, offset }) => ({
        sessions: mockSessions.slice(offset, offset + limit),
        total: mockSessions.length,
      }),
    });
    // User A populates cache
    await handler(
      "/sessions",
      "telegram",
      makeState({ externalChatId: "userA" }),
    );
    // User B has NOT called /sessions — /switch should fail
    const result = await handler(
      "/switch 1",
      "telegram",
      makeState({ externalChatId: "userB" }),
    );
    assert.ok(result);
    assert.ok(result.reply.includes("/sessions first"));
  });
});

describe("/history command", () => {
  it("shows recent messages", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      getSessionHistory: async (_sid, { limit, offset }) => ({
        messages: mockMessages.slice(offset, offset + limit),
        total: mockMessages.length,
      }),
    });
    const result = await handler("/history", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Hello"));
    assert.ok(result.reply.includes("page 1/"));
  });

  it("returns not available when getSessionHistory is not provided", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/history", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("not available"));
  });

  it("supports pagination", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      getSessionHistory: async (_sid, { limit, offset }) => ({
        messages: mockMessages.slice(offset, offset + limit),
        total: mockMessages.length,
      }),
    });
    const page2 = await handler("/history 2", "telegram", makeState());
    assert.ok(page2);
    // Page 2 should have the 6th message (index 5)
    assert.ok(page2.reply.includes("welcome"));
  });
});
