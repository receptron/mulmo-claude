// Host-injected runtime context for the accounting server surface.
//
// The backend can't reach into the host for the workspace root, the
// pub/sub instance, or the logger — those are host-specific. The host
// injects them once via `configureAccountingServer(...)` before
// mounting the router (server/index.ts), the server-side mirror of the
// Vue surface's `configureAccountingHost`. MulmoTerminal wires its own.
//
// `log` is a thin proxy that forwards to the injected logger so the
// many `log.warn("accounting", …)` call sites across the service layer
// stay unchanged. Before configuration (and in unit tests that drive
// the service with an explicit workspace root) it falls back to a
// console logger so nothing throws.

import type { StructuredLogger } from "@mulmoclaude/common";

/** Minimal pub/sub shape — structurally compatible with the host's
 *  `IPubSub`. The eventPublisher holds its own instance (set via
 *  `initAccountingEventPublisher`); this type is the contract. */
export interface IPubSub {
  publish: (channel: string, payload: unknown) => void;
}

/** Alias of the shared `StructuredLogger` — the host `Logger` stays directly assignable when injected. */
export type AccountingLogger = StructuredLogger;

export interface AccountingServerDeps {
  /** Absolute path to the workspace root (where `data/` lives). Used as
   *  the default when a service/io call doesn't pass an explicit root. */
  workspaceRoot: string;
  logger: AccountingLogger;
}

let deps: AccountingServerDeps | null = null;

/** Called once by the host before the accounting router is mounted. */
export function configureAccountingServer(context: AccountingServerDeps): void {
  deps = context;
}

/** Default workspace root for io calls that don't pass one explicitly.
 *  Throws if the host never configured the server — a real wiring bug
 *  (unit tests always pass an explicit root, so they never hit this). */
export function defaultWorkspaceRoot(): string {
  if (!deps) {
    throw new Error("@mulmoclaude/accounting-plugin: configureAccountingServer() must be called before serving accounting requests");
  }
  return deps.workspaceRoot;
}

const consoleLogger: AccountingLogger = {
  error: (namespace, msg, data) => console.error(`[${namespace}] ${msg}`, data ?? ""),
  warn: (namespace, msg, data) => console.warn(`[${namespace}] ${msg}`, data ?? ""),
  info: () => {},
  debug: () => {},
};

/** Logger proxy — forwards to the injected logger, console fallback
 *  before configuration. Lets call sites keep `log.warn("accounting", …)`. */
export const log: AccountingLogger = {
  error: (namespace, msg, data) => (deps?.logger ?? consoleLogger).error(namespace, msg, data),
  warn: (namespace, msg, data) => (deps?.logger ?? consoleLogger).warn(namespace, msg, data),
  info: (namespace, msg, data) => (deps?.logger ?? consoleLogger).info(namespace, msg, data),
  debug: (namespace, msg, data) => (deps?.logger ?? consoleLogger).debug(namespace, msg, data),
};
