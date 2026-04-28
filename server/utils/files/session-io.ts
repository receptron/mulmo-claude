import { appendFile } from "fs/promises";
import path from "node:path";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { readTextUnder, writeTextUnder, resolvePath, ensureWorkspaceDir } from "./workspace-io.js";

const CHAT = WORKSPACE_DIRS.chat;
const root = (rootOverride?: string) => rootOverride ?? workspacePath;

export function ensureChatDir(): void {
  ensureWorkspaceDir(CHAT);
}

function metaRel(sessionId: string): string {
  return path.posix.join(CHAT, `${sessionId}.json`);
}

function jsonlRel(sessionId: string): string {
  return path.posix.join(CHAT, `${sessionId}.jsonl`);
}

export interface SessionMeta {
  roleId?: string;
  startedAt?: string;
  firstUserMessage?: string;
  claudeSessionId?: string;
  hasUnread?: boolean;
  origin?: "human" | "scheduler" | "skill" | "bridge";
  [key: string]: unknown;
}

export type ReadMetaResult = { kind: "missing" } | { kind: "ok"; meta: SessionMeta } | { kind: "corrupt"; raw: string };

export async function readSessionMetaFull(sessionId: string, rootOverride?: string): Promise<ReadMetaResult> {
  const raw = await readTextUnder(root(rootOverride), metaRel(sessionId));
  if (raw === null) return { kind: "missing" };
  try {
    return { kind: "ok", meta: JSON.parse(raw) as SessionMeta };
  } catch {
    return { kind: "corrupt", raw };
  }
}

// Treats corrupt as null — callers that need to distinguish use readSessionMetaFull.
export async function readSessionMeta(sessionId: string, rootOverride?: string): Promise<SessionMeta | null> {
  const result = await readSessionMetaFull(sessionId, rootOverride);
  return result.kind === "ok" ? result.meta : null;
}

export async function writeSessionMeta(sessionId: string, meta: SessionMeta, rootOverride?: string): Promise<void> {
  await writeTextUnder(root(rootOverride), metaRel(sessionId), JSON.stringify(meta, null, 2));
}

export async function createSessionMeta(sessionId: string, roleId: string, firstUserMessage: string, rootOverride?: string, origin?: string): Promise<void> {
  const meta: Record<string, unknown> = {
    roleId,
    startedAt: new Date().toISOString(),
    firstUserMessage,
  };
  if (origin) meta.origin = origin;
  await writeSessionMeta(sessionId, meta, rootOverride);
}

export async function backfillOrigin(sessionId: string, origin: SessionMeta["origin"], rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(sessionId, rootOverride);
  if (!meta || meta.origin) return; // already set
  await writeSessionMeta(sessionId, { ...meta, origin }, rootOverride);
}

export async function backfillFirstUserMessage(sessionId: string, message: string, rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(sessionId, rootOverride);
  if (!meta || meta.firstUserMessage) return;
  await writeSessionMeta(sessionId, { ...meta, firstUserMessage: message }, rootOverride);
}

export async function setClaudeSessionId(sessionId: string, claudeSessionId: string, rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(sessionId, rootOverride);
  if (!meta) return;
  await writeSessionMeta(sessionId, { ...meta, claudeSessionId }, rootOverride);
}

export async function clearClaudeSessionId(sessionId: string, rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(sessionId, rootOverride);
  if (!meta) return;
  const { claudeSessionId: __removed, ...rest } = meta;
  await writeSessionMeta(sessionId, rest, rootOverride);
}

export async function updateHasUnread(sessionId: string, hasUnread: boolean, rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(sessionId, rootOverride);
  if (!meta) return;
  await writeSessionMeta(sessionId, { ...meta, hasUnread }, rootOverride);
}

export function sessionJsonlAbsPath(sessionId: string, rootOverride?: string): string {
  return resolvePath(root(rootOverride), jsonlRel(sessionId));
}

// .json sidecar to the event-log jsonl. mtime bumps on every writeSessionMeta — used as a "session changed" signal.
export function sessionMetaAbsPath(sessionId: string, rootOverride?: string): string {
  return resolvePath(root(rootOverride), metaRel(sessionId));
}

export async function readSessionJsonl(sessionId: string, rootOverride?: string): Promise<string | null> {
  return readTextUnder(root(rootOverride), jsonlRel(sessionId));
}

// Always ends with `\n` to prevent JSONL parse failures from a missing terminator.
export async function appendSessionLine(sessionId: string, line: string, rootOverride?: string): Promise<void> {
  const normalized = line.endsWith("\n") ? line : `${line}\n`;
  await appendFile(resolvePath(root(rootOverride), jsonlRel(sessionId)), normalized);
}
