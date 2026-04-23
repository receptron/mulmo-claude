// Composable for the server /api/health probe.
//
// Owns three refs that the UI reads (gemini key availability +
// sandbox toggle + server CPU load ratio) plus a one-shot fetch
// that populates them on mount, plus an optional periodic refresh
// for the CPU ratio (the favicon's "overloaded" rule needs a live
// signal, not a boot-time snapshot).
//
// On fetch failure we assume Gemini is unavailable so dependent UI
// (e.g. the "generate image" plugin buttons) falls back gracefully
// — the sandbox flag keeps its initial `true` so the lock indicator
// doesn't momentarily flash "sandbox disabled" on a transient error,
// and the CPU ratio goes to null so the favicon resolver skips the
// overloaded rule rather than guessing.

import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet } from "../utils/api";

// Once every 15 s is enough for a sustained load spike to light the
// favicon. Shorter would mostly flap on short-lived spikes that
// aren't actually user-visible as lag.
const HEALTH_REFRESH_MS = 15_000;

interface CpuPayload {
  load1?: unknown;
  cores?: unknown;
}

interface HealthResponse {
  geminiAvailable?: unknown;
  sandboxEnabled?: unknown;
  cpu?: CpuPayload;
}

export function useHealth(): {
  geminiAvailable: Ref<boolean>;
  sandboxEnabled: Ref<boolean>;
  cpuLoadRatio: ComputedRef<number | null>;
  fetchHealth: () => Promise<void>;
} {
  const geminiAvailable = ref(true);
  const sandboxEnabled = ref(true);
  const cpuLoad1 = ref<number | null>(null);
  const cpuCores = ref<number | null>(null);

  // Separate flag so transient poll failures don't flip
  // `geminiAvailable` back to false after a successful boot-time
  // fetch. `geminiAvailable` / `sandboxEnabled` are config-derived
  // and don't change at runtime — once we've observed them once,
  // the next 15 s poll's network blip shouldn't mask them.
  let bootFetchCompleted = false;

  async function fetchHealth(): Promise<void> {
    const result = await apiGet<HealthResponse>(API_ROUTES.health);
    if (!result.ok) {
      // Only the CPU figures get nulled — the favicon resolver
      // reads null as "skip overloaded" which is the correct fail-
      // closed behaviour. The config flags keep their last-known
      // values, and stay at the initial defaults if we never
      // succeeded (gemini=true → request lands, gets an auth error
      // handled elsewhere; sandbox=true → lock indicator reads on).
      cpuLoad1.value = null;
      cpuCores.value = null;
      if (!bootFetchCompleted) {
        // On the FIRST fetch we do still flip gemini → false so
        // the "Gemini key required" banner can show immediately
        // without waiting for a second attempt. Subsequent poll
        // failures don't re-enter this branch.
        geminiAvailable.value = false;
      }
      return;
    }
    geminiAvailable.value = !!result.data.geminiAvailable;
    sandboxEnabled.value = !!result.data.sandboxEnabled;
    bootFetchCompleted = true;
    const cpu = result.data.cpu;
    if (cpu && typeof cpu.load1 === "number" && Number.isFinite(cpu.load1) && typeof cpu.cores === "number" && cpu.cores > 0) {
      cpuLoad1.value = cpu.load1;
      cpuCores.value = cpu.cores;
    } else {
      cpuLoad1.value = null;
      cpuCores.value = null;
    }
  }

  // Refresh the CPU figure periodically. The flag-style booleans
  // (gemini / sandbox) don't change at runtime so re-fetching them
  // is waste; but piggy-backing on the same endpoint keeps the
  // server side to a single route and the client to a single poll.
  const refreshHandle = window.setInterval(() => {
    fetchHealth().catch(() => {
      /* intentionally swallowed — a failed poll just stalls the
         favicon's overloaded rule, not user-visible UI */
    });
  }, HEALTH_REFRESH_MS);
  onScopeDispose(() => window.clearInterval(refreshHandle));

  // Expose the normalised ratio the favicon resolver expects (load
  // per logical core). Null when either component is missing.
  const cpuLoadRatio = computed<number | null>(() => {
    if (cpuLoad1.value === null || cpuCores.value === null) return null;
    return cpuLoad1.value / cpuCores.value;
  });

  return { geminiAvailable, sandboxEnabled, cpuLoadRatio, fetchHealth };
}
