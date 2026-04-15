// Composable for the server /api/health probe.
//
// Owns two refs that the UI reads (gemini key availability + sandbox
// toggle) plus the one-shot fetch that populates them on mount. On
// fetch failure we assume Gemini is unavailable so dependent UI
// (e.g. the "generate image" plugin buttons) falls back gracefully
// — the sandbox flag keeps its initial `true` so the lock indicator
// doesn't momentarily flash "sandbox disabled" on a transient error.

import { ref, type Ref } from "vue";
import { apiGet } from "../utils/api";

interface HealthResponse {
  geminiAvailable?: unknown;
  sandboxEnabled?: unknown;
}

export function useHealth(): {
  geminiAvailable: Ref<boolean>;
  sandboxEnabled: Ref<boolean>;
  fetchHealth: () => Promise<void>;
} {
  const geminiAvailable = ref(true);
  const sandboxEnabled = ref(true);

  async function fetchHealth(): Promise<void> {
    const result = await apiGet<HealthResponse>("/api/health");
    if (!result.ok) {
      geminiAvailable.value = false;
      return;
    }
    geminiAvailable.value = !!result.data.geminiAvailable;
    sandboxEnabled.value = !!result.data.sandboxEnabled;
  }

  return { geminiAvailable, sandboxEnabled, fetchHealth };
}
