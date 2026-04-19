// Pure path helpers for the chat index cache. Kept in their own
// file so tests can compute expected paths without needing the
// summarizer / indexer modules (which transitively pull in the
// claude CLI spawn code).

import path from "node:path";

export const CHAT_DIR = "chat";
export const INDEX_DIR = "index";
export const MANIFEST_FILE = "manifest.json";

export function chatDirFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, CHAT_DIR);
}

export function indexDirFor(workspaceRoot: string): string {
  return path.join(chatDirFor(workspaceRoot), INDEX_DIR);
}

export function sessionJsonlPathFor(
  workspaceRoot: string,
  sessionId: string,
): string {
  return path.join(chatDirFor(workspaceRoot), `${sessionId}.jsonl`);
}

export function sessionMetaPathFor(
  workspaceRoot: string,
  sessionId: string,
): string {
  return path.join(chatDirFor(workspaceRoot), `${sessionId}.json`);
}

export function indexEntryPathFor(
  workspaceRoot: string,
  sessionId: string,
): string {
  return path.join(indexDirFor(workspaceRoot), `${sessionId}.json`);
}

export function manifestPathFor(workspaceRoot: string): string {
  return path.join(indexDirFor(workspaceRoot), MANIFEST_FILE);
}
