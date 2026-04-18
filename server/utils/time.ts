// Common time constants in milliseconds. Avoids magic numbers like
// 3_600_000 scattered across the codebase.
//
// All server-side code should import from here instead of using raw
// numeric literals. When a specific duration is needed (e.g. a
// 5-second timeout), express it as `5 * ONE_SECOND_MS`.

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

// ── Common timeout presets ──────────────────────────────────────
// Named timeouts for recurring patterns. Prefer these over inline
// `5 * ONE_SECOND_MS` when the same value is used in 3+ places.

/** Quick subprocess probe (docker ps, libreoffice --version, etc.) */
export const SUBPROCESS_PROBE_TIMEOUT_MS = 5 * ONE_SECOND_MS;

/** Heavy subprocess work (libreoffice conversion, etc.) */
export const SUBPROCESS_WORK_TIMEOUT_MS = ONE_MINUTE_MS;

/** CLI subprocess timeout (claude -p for summarization, etc.) */
export const CLI_SUBPROCESS_TIMEOUT_MS = 5 * ONE_MINUTE_MS;

/** Maximum one-shot notification delay */
export const MAX_NOTIFICATION_DELAY_SEC = 3_600; // 1 hour in seconds
