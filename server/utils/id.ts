// Unique-ID generation for persisted records. Previously duplicated
// in schedulerHandlers, todosHandlers, and todosItemsHandlers —
// consolidated here as part of the server/utils grouping (#350 CLAUDE.md).

import { randomBytes } from "crypto";

/**
 * Generate a short, unique, human-scannable ID.
 *
 * Format: `<prefix>_<epochMs>_<6 random hex chars>`. The prefix
 * is required so IDs from different domains (todo, scheduler, column)
 * are visually distinguishable in logs and JSON files.
 */
export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(3).toString("hex")}`;
}
