// Host binding for the Google engine. The engine logs through the host's
// logger, but a package-level import of the host logger would be an uphill
// dependency — so the host injects it once at startup (same pattern as
// `collection/server/host.ts`). The default is silent so the engine works
// unconfigured in unit tests.

import { createForwardingLogger, createHostSlot, type StructuredLogger } from "../host/hostSlot.js";

/** Public alias of the shared `StructuredLogger` — keeps the domain surface name-stable. */
export type GoogleLogger = StructuredLogger;

const hostSlot = createHostSlot<GoogleLogger>("@mulmoclaude/core/google: configureGoogleHost()");

export function configureGoogleHost(binding: { log: GoogleLogger }): void {
  hostSlot.set(binding.log);
}

export const log: GoogleLogger = createForwardingLogger(() => hostSlot.peek());
