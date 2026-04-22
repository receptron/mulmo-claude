// Type declarations for port.mjs. See port.mjs for rationale on why
// the shared helper lives in plain JS.

export const MAX_PORT_PROBES: number;
export function isPortFree(port: number): Promise<boolean>;
export function findAvailablePort(start: number): Promise<number | null>;
