// Lightweight atomic write — write to a sibling tmp file, then rename.
//
// A DELIBERATE second implementation of `writeFileAtomic`, catalogued as such
// in `docs/shared-utils.md`. The canonical one is
// `@mulmoclaude/core/files` — but this package sits in the bridge tier, below
// core, so importing it would be an uphill edge; and the helper needs
// `node:fs`, which rules out the browser-safe `@mulmoclaude/common` leaf that
// `errorMessage` / `escapeHtml` live in. @mulmobridge/chat-service therefore
// stays dependency-free beyond protocol.
//
// This is a SMALLER contract, not a drifted one: no `mode`, no `uniqueTmp`.
// Same core guarantee as the canonical — readers always see either the old
// file or the new file, never a half-written one — but without the canonical's
// Windows AV/Search-Indexer rename-retry loop, so a Windows-hosted bridge can
// still surface an EPERM here. Fix bugs in the canonical first, then decide
// whether this copy needs the same change.

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
