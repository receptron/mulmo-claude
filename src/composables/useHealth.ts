// On fetch failure: assume gemini unavailable (so "generate image" buttons fall back gracefully); keep sandbox=true
// so the lock indicator doesn't flash off on a transient error; null cpu so the favicon resolver skips overloaded
// rather than guessing.

import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet } from "../utils/api";

// 15s catches sustained load without flapping on short-lived spikes that aren't user-visible as lag.
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

  // gemini/sandbox are config-derived and don't change at runtime; once observed, a poll blip shouldn't unmask them.
  let bootFetchCompleted = false;

  async function fetchHealth(): Promise<void> {
    const result = await apiGet<HealthResponse>(API_ROUTES.health);
    if (!result.ok) {
      // Null only the CPU figures — the resolver reads null as "skip overloaded" (fail-closed). Config flags keep
      // their last-known values, defaults if never observed (gemini=true → auth error elsewhere, sandbox=true → on).
      cpuLoad1.value = null;
      cpuCores.value = null;
      if (!bootFetchCompleted) {
        // First-fetch only: flip gemini → false so the "Gemini key required" banner shows without waiting for retry.
        geminiAvailable.value = false;
      }
      return;
    }
    geminiAvailable.value = Boolean(result.data.geminiAvailable);
    sandboxEnabled.value = Boolean(result.data.sandboxEnabled);
    bootFetchCompleted = true;
    const { cpu } = result.data;
    if (cpu && typeof cpu.load1 === "number" && Number.isFinite(cpu.load1) && typeof cpu.cores === "number" && cpu.cores > 0) {
      cpuLoad1.value = cpu.load1;
      cpuCores.value = cpu.cores;
    } else {
      cpuLoad1.value = null;
      cpuCores.value = null;
    }
  }

  // Piggy-backs cpu refresh on the health endpoint to keep server + client to a single route/poll.
  const refreshHandle = window.setInterval(() => {
    fetchHealth().catch(() => {
      /* swallowed: a failed poll just stalls the favicon overloaded rule, not user-visible UI */
    });
  }, HEALTH_REFRESH_MS);
  onScopeDispose(() => window.clearInterval(refreshHandle));

  // load1 per logical core; null if either side is missing.
  const cpuLoadRatio = computed<number | null>(() => {
    if (cpuLoad1.value === null || cpuCores.value === null) return null;
    return cpuLoad1.value / cpuCores.value;
  });

  return { geminiAvailable, sandboxEnabled, cpuLoadRatio, fetchHealth };
}
