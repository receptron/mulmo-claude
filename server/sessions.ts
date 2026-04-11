import { appendFile } from "fs/promises";

type SendFn = (data: unknown) => void;

interface Session {
  send: SendFn;
  resultsFilePath: string;
  selectedImageData?: string;
}

interface ToolResultEvent {
  type: "tool_result";
  result: unknown;
}

const isToolResultEvent = (data: unknown): data is ToolResultEvent =>
  typeof data === "object" &&
  data !== null &&
  "type" in data &&
  data.type === "tool_result";

const sessions = new Map<string, Session>();

export function registerSession(
  id: string,
  send: SendFn,
  resultsFilePath: string,
  selectedImageData?: string,
): void {
  sessions.set(id, { send, resultsFilePath, selectedImageData });
}

export function getSessionImageData(id: string): string | undefined {
  return sessions.get(id)?.selectedImageData;
}

export function removeSession(id: string): void {
  sessions.delete(id);
}

// Snapshot of currently-live session ids. The journal module uses
// this to skip ingesting jsonl files that are still being written.
export function getActiveSessionIds(): Set<string> {
  return new Set(sessions.keys());
}

export async function pushToSession(
  id: string,
  data: unknown,
): Promise<boolean> {
  const session = sessions.get(id);
  if (!session) return false;
  session.send(data);
  if (isToolResultEvent(data)) {
    const { result } = data;
    await appendFile(
      session.resultsFilePath,
      JSON.stringify({ source: "tool", type: "tool_result", result }) + "\n",
    );
  }
  return true;
}
