// Common time constants in milliseconds. Avoids magic numbers like
// 3_600_000 scattered across the codebase.

export const ONE_SECOND_MS = 1_000;
export const ONE_MINUTE_MS = 60_000;
export const ONE_HOUR_MS = 3_600_000;
export const ONE_DAY_MS = 86_400_000;

/** Map time-unit suffixes (s/m/h) to milliseconds. */
export const TIME_UNIT_MS: Record<string, number> = {
  s: ONE_SECOND_MS,
  m: ONE_MINUTE_MS,
  h: ONE_HOUR_MS,
};
