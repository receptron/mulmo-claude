// Type declarations for smoke.mjs. Sidecar keeps the driver plain
// JS so `node scripts/mulmoclaude/smoke.mjs` works without a build
// step on a fresh clone.

import type { AuditOptions } from "./deps.mjs";
import type { CheckWorkspaceDriftOptions, PackageDriftResult } from "./drift.mjs";
import type { RunTarballSmokeOptions, TarballSmokeResult } from "./tarball.mjs";

/** Per-stage verdict in the driver output. */
export interface StageResult {
  name: "deps" | "drift" | "tarball";
  ok: boolean;
  /** Short human-readable one-liner shown in the CI log. */
  summary: string;
  /** Stage-specific diagnostics (missing packages, drifted names, tarball log path, …). */
  details: Record<string, unknown>;
}

/** Overall driver output — ok is true only when every stage passed. */
export interface SmokeResult {
  ok: boolean;
  stages: StageResult[];
}

/** Injectable stage implementations. Tests override these; the CLI uses the real modules. */
export interface RunSmokeOptions {
  root?: string;
  auditFn?: (options: AuditOptions) => Promise<string[]>;
  driftFn?: (options: CheckWorkspaceDriftOptions) => Promise<PackageDriftResult[]>;
  tarballFn?: (options: RunTarballSmokeOptions) => Promise<TarballSmokeResult>;
  tarballOptions?: Omit<RunTarballSmokeOptions, "root">;
  /** Skip the §4 tarball stage — useful when `yarn build` hasn't produced a dist yet. */
  skipTarball?: boolean;
}

export function runSmoke(options?: RunSmokeOptions): Promise<SmokeResult>;

/** CLI entry point. Returns 0 if every stage is ok, 1 otherwise. */
export function main(options?: { skipTarball?: boolean }): Promise<number>;
