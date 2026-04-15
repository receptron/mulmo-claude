import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { workspacePath } from "../workspace.js";
import { log } from "../logger/index.js";

// ── Types ────────────────────────────────────────────────────

export interface TransportChatState {
  externalChatId: string;
  sessionId: string;
  roleId: string;
  claudeSessionId?: string;
  startedAt: string;
  updatedAt: string;
}

// ── Path helpers ─────────────────────────────────────────────

/**
 * Validate that an external ID is safe for use in file paths.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
function isSafeId(id: string): boolean {
  return /^[\w.-]+$/.test(id) && id.length > 0 && id.length <= 200;
}

function getTransportDir(transportId: string): string {
  return path.join(workspacePath, "transports", transportId, "chats");
}

function getStatePath(transportId: string, externalChatId: string): string {
  return path.join(getTransportDir(transportId), `${externalChatId}.json`);
}

// ── Session ID generation ────────────────────────────────────

export function generateSessionId(
  transportId: string,
  externalChatId: string,
): string {
  return `${transportId}-${externalChatId}-${Date.now()}`;
}

// ── CRUD operations ──────────────────────────────────────────

export async function getChatState(
  transportId: string,
  externalChatId: string,
): Promise<TransportChatState | null> {
  if (!isSafeId(transportId) || !isSafeId(externalChatId)) return null;

  try {
    const raw = await readFile(
      getStatePath(transportId, externalChatId),
      "utf-8",
    );
    const parsed: TransportChatState = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

export async function setChatState(
  transportId: string,
  state: TransportChatState,
): Promise<void> {
  if (!isSafeId(transportId) || !isSafeId(state.externalChatId)) {
    throw new Error("Invalid transport or chat ID");
  }

  const dir = getTransportDir(transportId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    getStatePath(transportId, state.externalChatId),
    JSON.stringify(state, null, 2),
  );
}

export async function resetChatState(
  transportId: string,
  externalChatId: string,
  roleId: string,
): Promise<TransportChatState> {
  const now = new Date().toISOString();
  const state: TransportChatState = {
    externalChatId,
    sessionId: generateSessionId(transportId, externalChatId),
    roleId,
    startedAt: now,
    updatedAt: now,
  };
  await setChatState(transportId, state);
  log.info("chat-state", "reset", {
    transportId,
    externalChatId,
    sessionId: state.sessionId,
  });
  return state;
}

export async function connectSession(
  transportId: string,
  externalChatId: string,
  chatSessionId: string,
): Promise<TransportChatState | null> {
  const existing = await getChatState(transportId, externalChatId);
  if (!existing) return null;

  const updated: TransportChatState = {
    ...existing,
    sessionId: chatSessionId,
    updatedAt: new Date().toISOString(),
  };
  await setChatState(transportId, updated);
  log.info("chat-state", "connected", {
    transportId,
    externalChatId,
    sessionId: chatSessionId,
  });
  return updated;
}
