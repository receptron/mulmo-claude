// Time constants for the relay Worker.
//
// The relay runs as a Cloudflare Worker and is a separate package from the
// MulmoClaude server, so it cannot import from `server/utils/time.ts`.
// Duplicating only the constants the Worker actually uses.

export const ONE_SECOND_MS = 1_000;
export const ONE_HOUR_MS = 60 * 60 * ONE_SECOND_MS;
export const FIFTEEN_SECONDS_MS = 15 * ONE_SECOND_MS;
export const TEN_SECONDS_MS = 10 * ONE_SECOND_MS;
export const ONE_HOUR_S = 60 * 60;
