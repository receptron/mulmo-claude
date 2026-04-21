// Domain I/O: chat sessions
//   conversations/chat/<id>.json   — metadata
//   conversations/chat/<id>.jsonl  — event log
//
// All functions take optional `root` for test DI.

import { appendFile } from "fs/promises";
import path from "node:path";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { readTextUnder, writeTextUnder, resolvePath, ensureWorkspaceDir } from "./workspace-io.js";

const CHAT = WORKSPACE_DIRS.chat;
const root = (rootOverride?: string) => rootOverride ?? workspacePath;

/** Ensure the chat directory exists. Called once at session start. */
export function ensureChatDir(): void {
  ensureWorkspaceDir(CHAT);
}

function metaRel(id: string): string {
  return path.posix.join(CHAT, `${id}.json`);
}

function jsonlRel(id: string): string {
  return path.posix.join(CHAT, `${id}.jsonl`);
}

// ── Meta ────────────────────────────────────────────────────────

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

/** Read session metadata with full outcome discrimination. */
export async function readSessionMetaFull(id: string, rootOverride?: string): Promise<ReadMetaResult> {
  const raw = await readTextUnder(root(rootOverride), metaRel(id));
  if (raw === null) return { kind: "missing" };
  try {
    return { kind: "ok", meta: JSON.parse(raw) as SessionMeta };
  } catch {
    return { kind: "corrupt", raw };
  }
}

/** Convenience: returns the meta or null. Treats corrupt as null
 *  (callers that need to distinguish use readSessionMetaFull). */
export async function readSessionMeta(id: string, rootOverride?: string): Promise<SessionMeta | null> {
  const result = await readSessionMetaFull(id, rootOverride);
  return result.kind === "ok" ? result.meta : null;
}

export async function writeSessionMeta(id: string, meta: SessionMeta, rootOverride?: string): Promise<void> {
  await writeTextUnder(root(rootOverride), metaRel(id), JSON.stringify(meta, null, 2));
}

export async function createSessionMeta(id: string, roleId: string, firstUserMessage: string, rootOverride?: string, origin?: string): Promise<void> {
  const meta: Record<string, unknown> = {
    roleId,
    startedAt: new Date().toISOString(),
    firstUserMessage,
  };
  if (origin) meta.origin = origin;
  await writeSessionMeta(id, meta, rootOverride);
}

export async function backfillOrigin(id: string, origin: SessionMeta["origin"], rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(id, rootOverride);
  if (!meta || meta.origin) return; // already set
  await writeSessionMeta(id, { ...meta, origin }, rootOverride);
}

export async function backfillFirstUserMessage(id: string, message: string, rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(id, rootOverride);
  if (!meta || meta.firstUserMessage) return;
  await writeSessionMeta(id, { ...meta, firstUserMessage: message }, rootOverride);
}

export async function setClaudeSessionId(id: string, claudeSessionId: string, rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(id, rootOverride);
  if (!meta) return;
  await writeSessionMeta(id, { ...meta, claudeSessionId }, rootOverride);
}

export async function clearClaudeSessionId(id: string, rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(id, rootOverride);
  if (!meta) return;
  const { claudeSessionId: __removed, ...rest } = meta;
  await writeSessionMeta(id, rest, rootOverride);
}

export async function updateHasUnread(id: string, hasUnread: boolean, rootOverride?: string): Promise<void> {
  const meta = await readSessionMeta(id, rootOverride);
  if (!meta) return;
  await writeSessionMeta(id, { ...meta, hasUnread }, rootOverride);
}

// ── Jsonl ───────────────────────────────────────────────────────

export function sessionJsonlAbsPath(id: string, rootOverride?: string): string {
  return resolvePath(root(rootOverride), jsonlRel(id));
}

/**
 * Resolve the absolute path of a session's metadata JSON file. The
 * jsonl variant is the event log; this one is the sidecar that holds
 * `hasUnread`, `roleId`, `startedAt`, `origin`, etc. Its mtime bumps
 * whenever any of those fields change via `writeSessionMeta`.
 */
export function sessionMetaAbsPath(id: string, rootOverride?: string): string {
  return resolvePath(root(rootOverride), metaRel(id));
}

export async function readSessionJsonl(id: string, rootOverride?: string): Promise<string | null> {
  return readTextUnder(root(rootOverride), jsonlRel(id));
}

/**
 * Append a single line to the session event log (JSONL format).
 *
 * The function **ensures a trailing `\n`** — callers pass the raw
 * content and don't need to worry about line termination. This
 * prevents JSONL parse failures from missing newlines.
 */
export async function appendSessionLine(id: string, line: string, rootOverride?: string): Promise<void> {
  const normalized = line.endsWith("\n") ? line : `${line}\n`;
  await appendFile(resolvePath(root(rootOverride), jsonlRel(id)), normalized);
}
