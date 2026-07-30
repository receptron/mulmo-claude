// Optional host-binary registry + graceful-degradation probe (#1385).
//
// A missing optional binary must never crash the app: the feature
// that needs it disables itself, the user is warned once, and the
// rest keeps working. This module centralises the "is <binary>
// available?" question so we don't re-implement the lazy-cached
// probe per dependency (docker's ad-hoc check was the only one
// before this).

import which from "which";
import { detectLiveSandboxRuntime } from "./docker.js";

/** A single optional host dependency the app can run without. */
export interface OptionalDep {
  /** Stable id used by `depStatus()` lookups and notification ids. Kept a plain
   *  string — `probeOne` is a generic probe exercised with synthetic ids in the
   *  unit tests, so narrowing this to the registry union would over-constrain it. */
  readonly id: string;
  /** Binary name passed to `which` for the default presence probe. */
  readonly command: string;
  /** Alternative executable names that can satisfy one capability.
   *  The sandbox uses this on macOS, where Apple container or Docker
   *  are both valid providers. */
  readonly commands?: readonly string[];
  /** i18n key fragment naming what stops working when absent. */
  readonly enables: string;
  /** Override when "on PATH" is insufficient (e.g. docker client
   *  exists but the daemon is down). Returning false means the
   *  dependency is treated as unavailable even if `which` found it. */
  readonly probe?: () => Promise<boolean>;
}

export type DepReason = "ok" | "not-on-path" | "probe-failed";

export interface DepStatus {
  readonly id: string;
  readonly available: boolean;
  readonly reason: DepReason;
}

const REGISTRY: readonly OptionalDep[] = [
  {
    // Keep the stable id because plugin metadata and persisted
    // notification ids already use it; the capability is now generic.
    id: "docker",
    command: process.platform === "darwin" ? "container / docker" : "docker",
    commands: process.platform === "darwin" ? ["container", "docker"] : ["docker"],
    enables: "dockerSandbox",
    probe: async () => (await detectLiveSandboxRuntime()) !== null,
  },
  { id: "ffmpeg", command: "ffmpeg", enables: "mulmocast" },
  // Local voice input (whisper.cpp server binary). Spawned as a warm
  // sidecar, not loaded in-process — see server/system/whisper/. The
  // Homebrew `whisper-cpp` formula installs `whisper-server`.
  { id: "whisper", command: "whisper-server", enables: "voiceInput" },
];

async function onPath(command: string): Promise<boolean> {
  try {
    const resolved = await which(command, { nothrow: true });
    return resolved !== null;
  } catch {
    // `which` shouldn't throw with nothrow, but a corrupt PATH or
    // an fs error must degrade to "absent", never bubble up.
    return false;
  }
}

// Never throws — a missing optional dep degrades, it does not crash
// startup. A throwing PATH check or liveness `probe` is treated as
// "unavailable" rather than propagating into the boot sequence.
// `pathCheck` is injectable so unit tests exercise the reason
// mapping + override precedence without depending on the host's
// real PATH.
export async function probeOne(dep: OptionalDep, pathCheck: (command: string) => Promise<boolean> = onPath): Promise<DepStatus> {
  try {
    const commands = dep.commands ?? [dep.command];
    let found = false;
    for (const command of commands) {
      if (await pathCheck(command)) {
        found = true;
        break;
      }
    }
    if (!found) {
      return { id: dep.id, available: false, reason: "not-on-path" };
    }
    if (dep.probe && !(await dep.probe())) {
      return { id: dep.id, available: false, reason: "probe-failed" };
    }
    return { id: dep.id, available: true, reason: "ok" };
  } catch {
    return { id: dep.id, available: false, reason: "probe-failed" };
  }
}

let cache: Record<string, DepStatus> | null = null;
let inFlight: Promise<Record<string, DepStatus>> | null = null;

/** Probe every registered dependency in parallel. Cached for the
 *  process lifetime; concurrent callers share one in-flight run so
 *  `which` / the daemon probe fire once each. */
export async function probeOptionalDeps(): Promise<Record<string, DepStatus>> {
  if (cache) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const statuses = await Promise.all(REGISTRY.map((dep) => probeOne(dep)));
      cache = Object.fromEntries(statuses.map((status) => [status.id, status]));
      return cache;
    } catch {
      // probeOne never rejects, so this is unreachable in practice —
      // but if it ever did, returning an empty map keeps boot alive
      // (callers treat "no status" as "assume available"). Do NOT
      // poison `cache` so a later call can retry.
      return {};
    } finally {
      // Always clear so a rejected/failed run can't permanently
      // poison the cache (Codex review).
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Synchronous read of a previously-probed dependency. Returns
 *  undefined if `probeOptionalDeps()` has not completed yet — callers
 *  on the request path should treat that as "assume available" so a
 *  not-yet-probed boot window never blocks a feature. */
export function depStatus(depId: string): DepStatus | undefined {
  return cache?.[depId];
}

/** The registry, for callers that need the human-facing `enables`
 *  label (boot warning composition). */
export function optionalDeps(): readonly OptionalDep[] {
  return REGISTRY;
}

/** Test-only: drop the cache so a fresh probe runs next call. */
export function _resetOptionalDepsCacheForTest(): void {
  cache = null;
  inFlight = null;
}

/** Test-only: seed the probe cache directly so route guards and
 *  `announceOptionalDeps` behave deterministically without invoking
 *  the real `which` / daemon probe (CI has no control over whether
 *  ffmpeg/docker are installed on the runner). `probeOptionalDeps()`
 *  returns this seeded cache untouched (its first line is
 *  `if (cache) return cache;`). */
export function _setOptionalDepsCacheForTest(seed: Record<string, DepStatus>): void {
  cache = seed;
  inFlight = null;
}
