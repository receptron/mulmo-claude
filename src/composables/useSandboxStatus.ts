// #329. Lazy because env-var changes only take effect on server restart, so a page-lifetime cache is enough.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet } from "../utils/api";

export interface SandboxStatus {
  sshAgent: boolean;
  mounts: string[];
}

interface RawResponse {
  sshAgent?: unknown;
  mounts?: unknown;
}

function isSandboxStatus(raw: RawResponse): raw is {
  sshAgent: boolean;
  mounts: string[];
} {
  if (typeof raw.sshAgent !== "boolean") return false;
  if (!Array.isArray(raw.mounts)) return false;
  return raw.mounts.every((mount) => typeof mount === "string");
}

export interface UseSandboxStatusHandle {
  // null = not yet loaded / sandbox disabled / fetch failed (UI renders a placeholder for all three).
  status: Ref<SandboxStatus | null>;
  ensureLoaded: () => Promise<void>;
}

export function useSandboxStatus(): UseSandboxStatusHandle {
  const status = ref<SandboxStatus | null>(null);
  let loaded = false;

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const result = await apiGet<RawResponse>(API_ROUTES.sandbox);
    if (!result.ok) {
      // Allow retry on next open — `status` stays null so the popup shows "state unavailable".
      loaded = false;
      return;
    }
    // Server returns `{}` when the sandbox is disabled — popup shouldn't call us then, but double-guard.
    if (!isSandboxStatus(result.data)) return;
    status.value = result.data;
  }

  return { status, ensureLoaded };
}
