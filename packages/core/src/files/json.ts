import { writeFileAtomic, type WriteAtomicOptions } from "./atomic.js";

const JSON_INDENT = 2;

/** Atomic JSON write (2-space indent) — serialize then write through the atomic
 *  tmp-file + rename seam so a reader never sees a half-written document. */
export async function writeJsonAtomic(filePath: string, data: unknown, opts: WriteAtomicOptions = {}): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, JSON_INDENT), opts);
}
