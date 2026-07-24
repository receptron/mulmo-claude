// Minimal JSON file I/O for the token store. The token file must be 0600, so
// the write goes through the shared atomic writer with an explicit `mode`.
import { promises as fsp } from "node:fs";
import { writeFileAtomic } from "../files/atomic.js";

const JSON_INDENT = 2;

export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    const parsed: T = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

/** tmp-write + rename so readers never see a half-written file; `mode` applies
 *  to the tmp file and survives the rename. A single-writer token file, so the
 *  staging name is stable (`uniqueTmp: false`). */
export async function writeJsonAtomicWithMode(filePath: string, data: unknown, mode: number): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, JSON_INDENT), { mode, uniqueTmp: false });
}
