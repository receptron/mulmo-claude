export interface SessionFixture {
  id: string;
  title: string;
  roleId: string;
  startedAt: string;
  updatedAt: string;
  preview?: string;
  // Optional fields exercised by tab-bar tests — omitted fixtures
  // behave as if the flags were absent on the server summary.
  summary?: string;
  hasUnread?: boolean;
  isRunning?: boolean;
  origin?: "human" | "scheduler" | "skill" | "bridge";
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
