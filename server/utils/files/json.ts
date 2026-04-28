import { promises, readFileSync } from "fs";
import { writeFileAtomic } from "./atomic.js";
import { isEnoent } from "./safe.js";
import { log } from "../../system/logger/index.js";

// Returns defaultValue on ENOENT or parse failure (user data files must not take down the server); rethrows EACCES/EPERM.
export function loadJsonFile<T>(filePath: string, defaultValue: T): T {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return defaultValue;
    log.error("json", "loadJsonFile read failed", {
      path: filePath,
      error: String(err),
    });
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    log.error("json", "loadJsonFile parse failed, using default", {
      path: filePath,
      error: String(err),
    });
    return defaultValue;
  }
}

export async function writeJsonAtomic(filePath: string, data: unknown, opts: Parameters<typeof writeFileAtomic>[2] = {}): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2), opts);
}

export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const content = await promises.readFile(filePath, "utf-8");
    const parsed: T = JSON.parse(content);
    return parsed;
  } catch {
    return null;
  }
}
