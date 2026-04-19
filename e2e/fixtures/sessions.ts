export interface SessionFixture {
  id: string;
  title: string;
  roleId: string;
  startedAt: string;
  updatedAt: string;
  preview?: string;
}

export const SESSION_A: SessionFixture = {
  id: "session-aaa-111",
  title: "Session A",
  roleId: "general",
  startedAt: "2026-04-10T10:00:00Z",
  updatedAt: "2026-04-10T10:05:00Z",
  preview: "Hello from session A",
};

export const SESSION_B: SessionFixture = {
  id: "session-bbb-222",
  title: "Session B",
  roleId: "general",
  startedAt: "2026-04-11T14:00:00Z",
  updatedAt: "2026-04-11T14:10:00Z",
  preview: "Hello from session B",
};

export function makeSessionEntries(sessionId: string) {
  return [
    { type: "session_meta", roleId: "general", sessionId },
    { type: "text", source: "user", message: "Hello" },
    { type: "text", source: "assistant", message: "Hi there!" },
  ];
}
