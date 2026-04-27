import { readonly, ref, type Ref, type DeepReadonly } from "vue";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

export interface SkillSummary {
  name: string;
  description: string;
  source: "user" | "project";
}

const skills = ref<SkillSummary[]>([]);
const loaded = ref(false);
let inflight: Promise<void> | null = null;

async function fetchSkills(): Promise<void> {
  if (loaded.value) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const result = await apiGet<{ skills: SkillSummary[] }>(API_ROUTES.skills.list);
      if (result.ok && Array.isArray(result.data.skills)) {
        skills.value = result.data.skills;
      }
    } finally {
      loaded.value = true;
      inflight = null;
    }
  })();
  return inflight;
}

export function useSkillsList(): {
  skills: DeepReadonly<Ref<SkillSummary[]>>;
  loaded: DeepReadonly<Ref<boolean>>;
  refresh: () => Promise<void>;
} {
  void fetchSkills();
  return {
    skills: readonly(skills),
    loaded: readonly(loaded),
    refresh: async () => {
      loaded.value = false;
      inflight = null;
      await fetchSkills();
    },
  };
}
