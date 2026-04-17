// Domain I/O: chat sessions
//   conversations/chat/<id>.json   — metadata
//   conversations/chat/<id>.jsonl  — event log
//
// All functions take optional `root` for test DI.

import { appendFile } from "fs/promises";
import { WORKSPACE_DIRS } from "../../workspace/paths.js";
import { workspacePath } from "../../workspace/paths.js";
import { readTextUnder, writeTextUnder, resolvePath } from "./workspace-io.js";

const CHAT = WORKSPACE_DIRS.chat;
const root = (r?: string) => r ?? workspacePath;

// ── Meta ────────────────────────────────────────────────────────

export interface SessionMeta {
  roleId?: string;
  startedAt?: string;
  firstUserMessage?: string;
  claudeSessionId?: string;
  hasUnread?: boolean;
  [key: string]: unknown;
}

export async function readSessionMeta(
  id: string,
  r?: string,
): Promise<SessionMeta | null> {
  const raw = await readTextUnder(root(r), `${CHAT}/${id}.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return null;
  }
}

export async function writeSessionMeta(
  id: string,
  meta: SessionMeta,
  r?: string,
): Promise<void> {
  await writeTextUnder(root(r), `${CHAT}/${id}.json`, JSON.stringify(meta));
}

export async function createSessionMeta(
  id: string,
  roleId: string,
  firstUserMessage: string,
  r?: string,
): Promise<void> {
  await writeSessionMeta(
    id,
    { roleId, startedAt: new Date().toISOString(), firstUserMessage },
    r,
  );
}

export async function backfillFirstUserMessage(
  id: string,
  message: string,
  r?: string,
): Promise<void> {
  const meta = await readSessionMeta(id, r);
  if (!meta || meta.firstUserMessage) return;
  await writeSessionMeta(id, { ...meta, firstUserMessage: message }, r);
}

export async function setClaudeSessionId(
  id: string,
  claudeSessionId: string,
  r?: string,
): Promise<void> {
  const meta = await readSessionMeta(id, r);
  if (!meta) return;
  await writeSessionMeta(id, { ...meta, claudeSessionId }, r);
}

export async function clearClaudeSessionId(
  id: string,
  r?: string,
): Promise<void> {
  const meta = await readSessionMeta(id, r);
  if (!meta) return;
  const { claudeSessionId: __removed, ...rest } = meta;
  await writeSessionMeta(id, rest, r);
}

export async function updateHasUnread(
  id: string,
  hasUnread: boolean,
  r?: string,
): Promise<void> {
  const meta = await readSessionMeta(id, r);
  if (!meta) return;
  await writeSessionMeta(id, { ...meta, hasUnread }, r);
}

// ── Jsonl ───────────────────────────────────────────────────────

export function sessionJsonlAbsPath(id: string, r?: string): string {
  return resolvePath(root(r), `${CHAT}/${id}.jsonl`);
}

export async function readSessionJsonl(
  id: string,
  r?: string,
): Promise<string | null> {
  return readTextUnder(root(r), `${CHAT}/${id}.jsonl`);
}

/**
 * Append a single line to the session event log (JSONL format).
 *
 * The function **ensures a trailing `\n`** — callers pass the raw
 * content and don't need to worry about line termination. This
 * prevents JSONL parse failures from missing newlines.
 */
export async function appendSessionLine(
  id: string,
  line: string,
  r?: string,
): Promise<void> {
  const normalized = line.endsWith("\n") ? line : `${line}\n`;
  await appendFile(resolvePath(root(r), `${CHAT}/${id}.jsonl`), normalized);
}
