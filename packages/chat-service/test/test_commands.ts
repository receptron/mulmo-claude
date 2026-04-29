import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCommandHandler } from "../src/commands.ts";
import type { TransportChatState } from "../src/chat-state.ts";
import type { SessionSummary } from "../src/types.ts";

const roles = [
  { id: "general", name: "General" },
  { id: "office", name: "Office" },
];

function makeState(overrides?: Partial<TransportChatState>): TransportChatState {
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
    await handler("/sessions", "telegram", makeState({ externalChatId: "userA" }));
    // User B has NOT called /sessions — /switch should fail
    const result = await handler("/switch 1", "telegram", makeState({ externalChatId: "userB" }));
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

describe("unknown slash command", () => {
  it("rejects an unknown slash with help text when no skill list is wired", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/foo", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Unknown command: /foo"));
  });

  it("forwards to the agent (returns null) when the slash names a registered skill", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "shiritori", description: "Play shiritori" }],
    });
    const result = await handler("/shiritori", "telegram", makeState());
    assert.equal(result, null);
  });

  it("rejects an unregistered slash even when a skill list is wired", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "shiritori", description: "Play shiritori" }],
    });
    const result = await handler("/notaskill", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Unknown command: /notaskill"));
  });

  it("treats bare `/` as unknown (slice produces empty string, list ignored)", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      // Even a permissive list must NOT match the empty skill name.
      listRegisteredSkills: async () => [{ name: "", description: "wat" }],
    });
    const result = await handler("/", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Unknown command: /"));
  });

  it("includes registered skills in the unknown-command help footer", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [
        { name: "shiritori", description: "Play shiritori" },
        { name: "haiku", description: "Compose a haiku" },
      ],
    });
    const result = await handler("/foo", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Skills:"));
    assert.ok(result.reply.includes("/shiritori — Play shiritori"));
    assert.ok(result.reply.includes("/haiku — Compose a haiku"));
  });
});

describe("//{skill} shortcut", () => {
  it("returns forwardAs and resets state when the skill is registered", async () => {
    const resetCalls: Array<{ transportId: string; chatId: string; roleId: string }> = [];
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: (id) => roles.find((r) => r.id === id) ?? roles[0],
      resetChatState: async (transportId, chatId, roleId) => {
        resetCalls.push({ transportId, chatId, roleId });
        return makeState({ roleId, sessionId: "sess-new" });
      },
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "shiritori", description: "Play shiritori" }],
    });
    const result = await handler("//shiritori", "telegram", makeState({ roleId: "office" }));
    assert.ok(result);
    assert.equal(result.forwardAs, "/shiritori");
    assert.ok(result.nextState);
    assert.equal(result.nextState?.sessionId, "sess-new");
    assert.equal(resetCalls.length, 1);
    assert.equal(resetCalls[0].roleId, "office");
  });

  it("rejects // with a skill that is not registered", async () => {
    let resetCalled = false;
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => {
        resetCalled = true;
        return makeState({ roleId });
      },
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "shiritori", description: "Play shiritori" }],
    });
    const result = await handler("//notaskill", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, undefined);
    assert.ok(result.reply.includes("Unknown command: //notaskill"));
    assert.equal(resetCalled, false);
  });

  it("rejects bare // (empty skill name never matches)", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "", description: "wat" }],
    });
    const result = await handler("//", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, undefined);
    assert.ok(result.reply.includes("Unknown command: //"));
  });

  it("forwards args after the skill name verbatim", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId, sessionId: "sess-new" }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "mag2", description: "Write a newsletter from a URL" }],
    });
    const result = await handler("//mag2 https://example.com/post", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, "/mag2 https://example.com/post");
    assert.equal(result.nextState?.sessionId, "sess-new");
  });

  it("forwards multi-token args after the skill name", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [{ name: "mag2", description: "Write a newsletter" }],
    });
    const result = await handler("//mag2 https://x.com/u/1 in Japanese", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, "/mag2 https://x.com/u/1 in Japanese");
  });

  it("rejects // when no skill list is wired", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("//shiritori", "telegram", makeState());
    assert.ok(result);
    assert.equal(result.forwardAs, undefined);
    assert.ok(result.reply.includes("Unknown command: //shiritori"));
  });
});

describe("/help command", () => {
  it("omits the Skills section when no skill list is wired", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
    });
    const result = await handler("/help", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Commands:"));
    assert.ok(!result.reply.includes("Skills:"));
  });

  it("omits the Skills section when the skill list is empty", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [],
    });
    const result = await handler("/help", "telegram", makeState());
    assert.ok(result);
    assert.ok(!result.reply.includes("Skills:"));
  });

  it("lists registered skills with descriptions in the Skills section", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [
        { name: "shiritori", description: "Play shiritori" },
        { name: "haiku", description: "Compose a haiku" },
      ],
    });
    const result = await handler("/help", "telegram", makeState());
    assert.ok(result);
    assert.ok(result.reply.includes("Skills:"));
    assert.ok(result.reply.includes("/shiritori — Play shiritori"));
    assert.ok(result.reply.includes("/haiku — Compose a haiku"));
    assert.ok(result.reply.includes("//<skill>"));
  });

  it("omits the //<skill> tip when no skills are registered", async () => {
    const handler = createCommandHandler({
      loadAllRoles: () => roles,
      getRole: () => roles[0],
      resetChatState: async (_t, _c, roleId) => makeState({ roleId }),
      connectSession: async () => makeState(),
      listRegisteredSkills: async () => [],
    });
    const result = await handler("/help", "telegram", makeState());
    assert.ok(result);
    assert.ok(!result.reply.includes("//<skill>"));
  });
});
