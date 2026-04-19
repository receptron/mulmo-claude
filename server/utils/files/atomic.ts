// Atomic file-write primitives. rename(2) is atomic on POSIX; Node's
// Windows implementation falls back to copy+unlink which is still
// safer than truncating the target in place. Readers always see
// either the old file or the new file — never a half-written one.
//
// Moved from server/utils/file.ts (issue #366 Phase 1). The old
// file re-exports these for backwards compat.

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export interface WriteAtomicOptions {
  /** File mode for the final file (e.g. `0o600` for secrets). */
  mode?: number;
  /**
   * If true, append a randomUUID to the tmp filename to avoid
   * collisions at the OS level when multiple writers target the same
   * final path concurrently (e.g. chat-index has this concern).
   * Default false — a single `${path}.tmp` is fine for most callers.
   */
  uniqueTmp?: boolean;
}

/**
 * Write `content` to `filePath` atomically. The parent directory is
 * created if missing. The tmp file is cleaned up on failure so a
 * crashed partial write can't wedge the next try.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  opts: WriteAtomicOptions = {},
): Promise<void> {
  const tmp = opts.uniqueTmp
    ? `${filePath}.${randomUUID()}.tmp`
    : `${filePath}.tmp`;
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.promises.writeFile(tmp, content, {
      encoding: "utf-8",
      mode: opts.mode,
    });
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Synchronous atomic write for callers that need it (e.g. server
 * startup, config saves that must complete before the next line).
 * Same contract as `writeFileAtomic` but blocking.
 */
export function writeFileAtomicSync(
  filePath: string,
  content: string,
  opts: WriteAtomicOptions = {},
): void {
  const tmp = opts.uniqueTmp
    ? `${filePath}.${randomUUID()}.tmp`
    : `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tmp, content, { encoding: "utf-8", mode: opts.mode });
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // best-effort cleanup
    }
    throw err;
  }
}
