// Small self-contained utilities so the package has no host dependencies.

export const ONE_SECOND_MS = 1_000;
export const ONE_MINUTE_MS = 60_000;

export { errorMessage } from "../utils/errors.js";

/** Minimal logger the host can inject; defaults to no-op so the package
 *  is silent unless wired up. */
export interface WhisperLogger {
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}

const NOOP = (): void => undefined;
export const NOOP_LOGGER: WhisperLogger = { info: NOOP, warn: NOOP, error: NOOP };
