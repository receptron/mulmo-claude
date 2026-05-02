// Type declarations for tarball.mjs. Sidecar keeps the script
// plain JS so `node scripts/mulmoclaude/tarball.mjs` works without
// a build step.

/**
 * Ask the OS for a random free TCP port on 127.0.0.1. Binds to 0,
 * reads the assigned port, closes the socket. There's a small
 * TOCTOU window before the port is reused — acceptable for a
 * smoke test.
 */
export function allocateRandomPort(): Promise<number>;

/** Outcome of a single HTTP poll loop. */
export interface PollResult {
  ok: boolean;
  attempts: number;
  elapsedMs: number;
  lastError?: string | null;
}

/** Options for the HTTP poller. `fetchImpl`/`now`/`sleep` injectable for tests. */
export interface PollHttpOptions {
  url: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function pollHttp(options: PollHttpOptions): Promise<PollResult>;

/** Shape of the throwaway package.json we write into the install dir. */
export interface InstallerPackageJson {
  name: string;
  version: string;
  private: true;
  description: string;
  dependencies: Record<string, string>;
}

export function buildInstallerPackageJson(options?: { tarballName?: string }): InstallerPackageJson;

export interface RunTarballSmokeOptions {
  root?: string;
  workDir?: string;
  logFile?: string;
  bootTimeoutMs?: number;
  packTimeoutMs?: number;
  installTimeoutMs?: number;
  port?: number;
}

/** Outcome of the runtime-plugin list probe. */
export interface RuntimePluginProbeResult {
  ok: boolean;
  status: number | null;
  plugins: number;
  lastError: string | null;
}

export interface ProbeRuntimePluginsOptions {
  port: number;
  token: string | null;
  fetchImpl?: typeof globalThis.fetch;
}

export function probeRuntimePlugins(options: ProbeRuntimePluginsOptions): Promise<RuntimePluginProbeResult>;

export interface ReadTokenFromLauncherLogOptions {
  logFile: string;
  readFileImpl?: (filePath: string, encoding: "utf8") => Promise<string>;
}

export function readTokenFromLauncherLog(options: ReadTokenFromLauncherLogOptions): Promise<string | null>;

/** Result of a full tarball smoke run — always resolves, never throws. */
export interface TarballSmokeResult {
  ok: boolean;
  port: number | null;
  attempts: number;
  elapsedMs: number;
  lastError: string | null;
  tarballPath: string | null;
  workDir: string;
  logFile: string;
  pluginProbe: RuntimePluginProbeResult | null;
}

export function runTarballSmoke(options?: RunTarballSmokeOptions): Promise<TarballSmokeResult>;

/** CLI entry point — exits 0 on 200 response, 1 on any failure. */
export function main(): Promise<number>;
