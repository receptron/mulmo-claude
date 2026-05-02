// Install ledger I/O for runtime-loaded plugins (#1043 C-2).
//
// The ledger is `~/mulmoclaude/plugins/plugins.json`, listing every
// plugin the user has installed via the install CLI / web UI. Each
// entry pairs the npm package id with the on-disk tgz filename; the
// loader replays this at boot to know what to extract from
// `plugins/` into `plugins/.cache/<name>/<version>/`.
//
// Truncating or deleting this file removes nothing on disk but
// "uninstalls" all runtime plugins on the next boot — the tgz files
// in `plugins/` and the cache mirror are GC'd on the following start.
// Editing it by hand is a supported recovery path.
//
// Reads tolerate missing / malformed JSON (returns []), so a half-
// written ledger never bricks server boot. Writes go through the
// atomic helper, so a crashed install can't leave a corrupt file.

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadJsonFile, writeJsonAtomic } from "./json.js";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";

export interface LedgerEntry {
  /** npm package name, e.g. `@gui-chat-plugin/weather`. */
  name: string;
  /** Semver string from the tgz's `package.json`, e.g. `0.1.0`. */
  version: string;
  /** Basename of the tgz inside `plugins/`. Joined with
   *  `WORKSPACE_PATHS.plugins` to read. */
  tgz: string;
  /** ISO 8601 timestamp of the install. */
  installedAt: string;
}

const isLedgerEntry = (value: unknown): value is LedgerEntry => {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.name === "string" && typeof obj.version === "string" && typeof obj.tgz === "string" && typeof obj.installedAt === "string";
};

const sanitiseLedger = (raw: unknown): LedgerEntry[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isLedgerEntry);
};

export function readLedger(): LedgerEntry[] {
  const raw = loadJsonFile<unknown>(WORKSPACE_PATHS.pluginsLedger, []);
  return sanitiseLedger(raw);
}

export async function writeLedger(entries: readonly LedgerEntry[]): Promise<void> {
  const dir = path.dirname(WORKSPACE_PATHS.pluginsLedger);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeJsonAtomic(WORKSPACE_PATHS.pluginsLedger, [...entries]);
}
