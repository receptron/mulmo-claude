// Lazy fetcher for `GET /api/sandbox` (#329).
//
// The lock popup consumes this to show which host credentials are
// attached to the Docker sandbox. Deliberately lazy: the popup is
// hidden most of the time, and env-var changes only take effect on
// server restart anyway, so a page-lifetime cache populated on first
// open is enough.
//
// Paired with `useHealth` (which loads `sandboxEnabled` at bootstrap)
// — when the sandbox is disabled this composable is never called.

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
  return raw.mounts.every((m) => typeof m === "string");
}

export interface UseSandboxStatusHandle {
  /** Parsed status, or null while not yet loaded / sandbox disabled
   *  / fetch failed. UI renders a placeholder in all three cases. */
  status: Ref<SandboxStatus | null>;
  /** One-shot loader. Safe to call repeatedly — short-circuits once a
   *  non-null value is cached. Designed to be triggered from a
   *  `watch(() => props.open, …)` on the popup. */
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
      // Leave `status` null — popup shows a neutral "state unavailable"
      // line. Allow a retry on next open by flipping `loaded` back.
      loaded = false;
      return;
    }
    // Server returns `{}` (empty object) when the sandbox is disabled.
    // The popup shouldn't call us in that case, but double-guard here
    // so a stale render doesn't blow up on shape validation.
    if (!isSandboxStatus(result.data)) return;
    status.value = result.data;
  }

  return { status, ensureLoaded };
}
