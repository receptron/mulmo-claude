// Module-singleton view of the host's runtime config — currently
// just `devMode`. Initial value is read synchronously from
// `import.meta.env.VITE_DEV_MODE` (mirrored from `DEV_MODE` by
// vite.config.ts) so consumers can render correctly on first paint;
// the runtime endpoint then confirms / overrides for the production
// case where the client bundle was built before the server's
// `DEV_MODE` was flipped.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet } from "../utils/api";

interface SystemConfig {
  devMode: boolean;
}

// `import.meta.env` is injected by Vite at build / dev time. It's
// undefined when this module is imported by `node:test` (which is
// how unit tests reach the composable). Guard the access so the
// module loads cleanly in both runtimes — under Node we fall back
// to "off" and let the test exercise `applyDevModeFilter` against
// an explicit boolean argument.
const importMetaEnv = (import.meta as { env?: { VITE_DEV_MODE?: string } }).env;
const initialDevMode = importMetaEnv?.VITE_DEV_MODE === "1";
const devMode = ref<boolean>(initialDevMode);
let refreshPromise: Promise<void> | null = null;

async function fetchOnce(): Promise<void> {
  const result = await apiGet<SystemConfig>(API_ROUTES.system.config);
  if (!result.ok) {
    // Keep the compile-time fallback. Logging through console because
    // the structured logger is server-only.
    console.warn(`[useSystemConfig] fetch failed: ${result.status} ${result.error}`);
    return;
  }
  devMode.value = result.data.devMode;
}

export function useSystemConfig(): {
  devMode: Ref<boolean>;
  refresh: () => Promise<void>;
} {
  if (!refreshPromise) {
    refreshPromise = fetchOnce();
  }
  return {
    devMode,
    refresh: () => fetchOnce(),
  };
}
