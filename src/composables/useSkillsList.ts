import { readonly, ref, type Ref, type DeepReadonly } from "vue";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

export interface SkillSummary {
  name: string;
  description: string;
  source: "user" | "project";
}

// Module-level shared state so consumers (ChatInput, PageChatComposer,
// SuggestionsPanel) all see the same list. We do not cache: every
// `refresh()` re-hits /api/skills. The first auto-fetch on mount is
// a bootstrap so the toggle button's visibility is correct on load;
// everything beyond that re-reads from disk (deletions in /skills
// would otherwise leave stale entries here — see issue from #885 review).
const skills = ref<SkillSummary[]>([]);
let bootstrapped = false;
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await apiGet<{ skills: SkillSummary[] }>(API_ROUTES.skills.list);
      if (result.ok && Array.isArray(result.data.skills)) {
        skills.value = result.data.skills;
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useSkillsList(): {
  skills: DeepReadonly<Ref<SkillSummary[]>>;
  refresh: () => Promise<void>;
} {
  if (!bootstrapped) {
    bootstrapped = true;
    void refresh();
  }
  return {
    skills: readonly(skills),
    refresh,
  };
}
