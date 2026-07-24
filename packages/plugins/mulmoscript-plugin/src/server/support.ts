// Small server-side utilities. The realpath-based traversal check the ops
// depend on used to live here as a faithful copy of the host's — it is now
// imported from `@mulmoclaude/core/files` (#2461) so the security-critical
// primitive cannot drift per host.

import { readFile } from "node:fs/promises";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/[^;]+;base64,/, "");
}

// Async so reading a large generated image/audio file doesn't stall the
// host's event loop (CodeRabbit on #2137).
export async function fileToDataUri(filePath: string, mimeType: string): Promise<string> {
  const data = await readFile(filePath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}
