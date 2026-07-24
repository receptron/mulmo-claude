// Shared host-injection primitives for the server-side engines. Each engine is
// parameterized over host-owned dependencies (workspace root, logger, file
// writer, …) that would be an uphill import if pulled in directly. Instead the
// host wires them ONCE at startup and the engine reads them back through a slot.
// This file centralises the storage/throw/no-op contract so the three domain
// bindings (collection, feeds, google) can't drift into subtly different
// behaviour.

/** Structured logger shape the engines log through — `(prefix, message,
 *  data?)`, matching the host `Logger`. The domains re-declare their own
 *  identically-shaped alias so their public surface is unchanged. */
export interface StructuredLogger {
  error: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  warn: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  info: (prefix: string, message: string, data?: Record<string, unknown>) => void;
  debug: (prefix: string, message: string, data?: Record<string, unknown>) => void;
}

/** A single host-injected dependency, wired once at boot and read back by the
 *  engine. `get()` fails loudly when the host never configured (the engine
 *  cannot operate without it); `peek()` stays quiet for non-critical reads. */
export interface HostSlot<T> {
  /** Wire the value. Re-binding to a *different* value throws — silently
   *  redirecting a configured engine to another host would be a bug. Re-binding
   *  the same value is a no-op. */
  set: (value: T) => void;
  /** The configured value, or throw (with the slot name) if never set. */
  get: () => T;
  /** The configured value, or `null` if never set — never throws. */
  peek: () => T | null;
  /** Test-only: forget the configured value. */
  reset: () => void;
}

export function createHostSlot<T>(name: string): HostSlot<T> {
  let current: T | null = null;
  const set = (value: T): void => {
    if (current !== null && current !== value) {
      throw new Error(`${name} was already called with a different host`);
    }
    current = value;
  };
  const get = (): T => {
    if (current === null) throw new Error(`${name} was not called by the host`);
    return current;
  };
  return { set, get, peek: () => current, reset: () => (current = null) };
}

/** Build the 4-method forwarding logger over a `() => StructuredLogger | null`
 *  getter. Calls made before a logger is available are dropped — logging is
 *  non-critical, unlike a required getter which fails loudly. Centralised so no
 *  domain can drift into throwing where a sibling drops. */
export function createForwardingLogger(getLogger: () => StructuredLogger | null): StructuredLogger {
  return {
    error: (prefix, message, data) => getLogger()?.error(prefix, message, data),
    warn: (prefix, message, data) => getLogger()?.warn(prefix, message, data),
    info: (prefix, message, data) => getLogger()?.info(prefix, message, data),
    debug: (prefix, message, data) => getLogger()?.debug(prefix, message, data),
  };
}
