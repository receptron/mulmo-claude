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
  /** npm `overrides` pinning the launcher's first-party workspace deps to local
   *  `file:` tarballs. Omitted when the map is empty. */
  overrides?: Record<string, string>;
}

export function buildInstallerPackageJson(options?: { tarballName?: string; overrides?: Record<string, string> }): InstallerPackageJson;

/** One workspace package discovered from the root `workspaces` globs. */
export interface WorkspacePackage {
  name: string;
  dir: string;
  private: boolean;
  /** dependencies + peerDependencies + optionalDependencies names. */
  deps: string[];
}

/** Result of the injectable command runner (npm pack). */
export interface RunCommandResult {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** Enumerate every workspace package by expanding the root `workspaces` globs. */
export function enumerateWorkspacePackages(
  root: string,
  options?: {
    readFileImpl?: (filePath: string, encoding: "utf8") => Promise<string>;
    readdirImpl?: (dirPath: string, options: { withFileTypes: true }) => Promise<{ name: string; isDirectory: () => boolean }[]>;
  },
): Promise<WorkspacePackage[]>;

/** Pure BFS: transitive first-party (workspace) deps reachable from `rootName`,
 *  excluding the root itself. Third-party deps are naturally excluded. */
export function computeFirstPartyClosure(packages: { name: string; deps: string[] }[], rootName: string): Set<string>;

/** Build an npm `file:` specifier from a native tarball path, normalising the
 *  platform separator to `/`. `sep` defaults to `path.sep`; pass it explicitly
 *  to exercise the Windows shape from a POSIX host. */
export function toFileSpecifier(tarballPath: string, sep?: string): string;

/** The tarball filename out of `npm pack --json` stdout, across every output
 *  shape npm emits (array, flat object, object keyed by package name), or
 *  `null` when the payload carries none. */
export function packFilenameFrom(stdout: string): string | null;

export interface PackWorkspaceOverridesOptions {
  root: string;
  packDir: string;
  runCommandImpl?: (cmd: string, args: string[], options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }) => Promise<RunCommandResult>;
  enumerateImpl?: (root: string) => Promise<WorkspacePackage[]>;
  packTimeoutMs?: number;
}

/** Pack the launcher's first-party dependency closure to local tarballs and
 *  return an npm `overrides` map `{ name: "file:<abs.tgz>" }`. */
export function packWorkspaceOverrides(options: PackWorkspaceOverridesOptions): Promise<Record<string, string>>;

export interface RunTarballSmokeOptions {
  root?: string;
  workDir?: string;
  logFile?: string;
  bootTimeoutMs?: number;
  packTimeoutMs?: number;
  installTimeoutMs?: number;
  port?: number;
  /** When true, generate a minimal dev-plugin fixture in workDir and
   *  boot the launcher with `--dev-plugin <fixture>`. The plugin
   *  probe then asserts the fixture appears in the runtime list with
   *  version `"dev"` (regression test for #1159 PR2). */
  devPlugin?: boolean;
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
  /** When set, the probe additionally asserts that a plugin matching
   *  this name appears in the list with version `"dev"`. Used by the
   *  smoke variant that boots with `--dev-plugin <fixture>`. */
  expectedDevPlugin?: string | null;
  /** Upper bound on how long to keep polling the list endpoint while
   *  waiting for `expectedDevPlugin` to appear. Plugin loading is a
   *  fire-and-forget IIFE that resolves after `app.listen()`, so a
   *  single-shot probe can race the loader and see an empty array.
   *  Ignored when `expectedDevPlugin` is absent. */
  pollTimeoutMs?: number;
  /** Delay between poll attempts when waiting for `expectedDevPlugin`. */
  pollIntervalMs?: number;
  /** Injectable clock for tests — defaults to `Date.now`. */
  now?: () => number;
  /** Injectable sleep for tests — defaults to a real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

export function probeRuntimePlugins(options: ProbeRuntimePluginsOptions): Promise<RuntimePluginProbeResult>;

export interface DevPluginFixture {
  absPath: string;
  name: string;
}

export interface MakeDevPluginFixtureOptions {
  workDir: string;
  /** package.json `name`. Default `@smoke/dev-fixture`. */
  name?: string;
  /** Subdirectory of `workDir` to lay out the fixture in. Default
   *  `dev-plugin-fixture`. */
  subdir?: string;
}

/** Lay out a minimal dev-plugin directory (package.json + dist/index.js)
 *  under `workDir`. Used by `runTarballSmoke({ devPlugin: true })` and
 *  exercised in tests independently. */
export function makeDevPluginFixture(options: MakeDevPluginFixtureOptions): Promise<DevPluginFixture>;

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
