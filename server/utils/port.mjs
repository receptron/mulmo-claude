// Shared port-resolution helpers for the dev server and the npm
// launcher (`packages/mulmoclaude/bin/mulmoclaude.js`).
//
// Kept as plain `.mjs` (no TypeScript) because the launcher runs
// directly under Node — it boots BEFORE tsx is wired up, so it can't
// import from a `.ts` file. The server-side TypeScript imports this
// through Node's ESM resolution; `moduleResolution: "bundler"` + the
// sibling `port.d.mts` declarations give us the type coverage without
// turning the whole `server/` tree into mixed JS/TS.

import net from "node:net";

// Scan cap: 20 slots is enough to step around the occasional stale
// server on `localhost` without spinning forever on a pathologically
// saturated machine.
export const MAX_PORT_PROBES = 20;

/**
 * Returns true iff binding `127.0.0.1:port` would succeed right now.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    // Probe the same interface we'll actually bind to so a port
    // held by a different process on a different interface doesn't
    // give us a false "free" reading.
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Walk forward from `start` until we find a free port. Returns `null`
 * if every slot in `[start, start + MAX_PORT_PROBES)` is busy.
 * @param {number} start
 * @returns {Promise<number | null>}
 */
export async function findAvailablePort(start) {
  for (let candidate = start; candidate < start + MAX_PORT_PROBES; candidate++) {
    if (await isPortFree(candidate)) return candidate;
  }
  return null;
}
