// Time + type helpers kept local so the Google engine carries no host
// dependency. `errorMessage` / `truncate` now come from the canonical core
// helpers (#2217): the local copies had drifted — `errorMessage` collapsed
// gRPC-shaped errors to "unknown error" instead of surfacing their `details`,
// and `truncate` dropped the guard that keeps output within `max`.
export { errorMessage } from "../utils/errors.js";
export { truncate } from "../utils/text.js";

export const ONE_SECOND_MS = 1_000;
export const ONE_MINUTE_MS = 60_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
