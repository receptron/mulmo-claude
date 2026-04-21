// Lightweight atomic write — write to a sibling tmp file, then rename.
//
// Inlined in this package (not imported from the host app) so
// @mulmobridge/chat-service stays dependency-free beyond protocol.
// Same contract as the host's writeFileAtomic: readers always see
// either the old file or the new file — never a half-written one.

import { writeFile, rename, unlink, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(tmp, content, "utf-8");
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
