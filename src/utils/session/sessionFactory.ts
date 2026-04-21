// Pure factory for creating a blank ActiveSession.

import type { ActiveSession } from "../../types/session";

export function createEmptySession(id: string, roleId: string): ActiveSession {
  const now = new Date().toISOString();
  return {
    id,
    roleId,
    toolResults: [],
    resultTimestamps: new Map(),
    isRunning: false,
    statusMessage: "",
    toolCallHistory: [],
    selectedResultUuid: null,
    hasUnread: false,
    startedAt: now,
    updatedAt: now,
    runStartIndex: 0,
    pendingGenerations: {},
  };
}
