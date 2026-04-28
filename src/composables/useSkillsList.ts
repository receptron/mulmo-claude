import { readonly, ref, type Ref, type DeepReadonly } from "vue";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

export interface SkillSummary {
  name: string;
  description: string;
  source: "user" | "project";
}

// Module-level shared state across consumers. Failed fetch keeps the previous list (no visual wipe on a blip) and
// surfaces the message via `error` — the Skills tab renders that as a banner so stale vs current is distinguishable.
const skills = ref<SkillSummary[]>([]);
const error = ref<string | null>(null);
let bootstrapped = false;
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await apiGet<{ skills: SkillSummary[] }>(API_ROUTES.skills.list);
      if (result.ok && Array.isArray(result.data.skills)) {
        skills.value = result.data.skills;
        error.value = null;
        return;
      }
      // Leave `skills` untouched (stale > wiped); surface on `error` AND console.warn — silent failures here had
      // historically made "Skills tab won't refresh" hard to diagnose without breakpoints.
      const message = !result.ok ? result.error || "Failed to load skills" : "Skills response missing `skills` array";
      error.value = message;
      console.warn("[useSkillsList] refresh failed:", message);
    } catch (err) {
      // Runtime throw must not become an unhandled rejection — the bootstrap call site is `void refresh()`.
      const message = err instanceof Error ? err.message : String(err);
      error.value = message;
      console.warn("[useSkillsList] refresh threw:", err);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useSkillsList(): {
  skills: DeepReadonly<Ref<SkillSummary[]>>;
  error: DeepReadonly<Ref<string | null>>;
  refresh: () => Promise<void>;
} {
  if (!bootstrapped) {
    bootstrapped = true;
    void refresh();
  }
  return {
    skills: readonly(skills),
    error: readonly(error),
    refresh,
  };
}
