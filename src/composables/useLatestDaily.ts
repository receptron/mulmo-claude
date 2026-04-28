// #876. Distinguish data===null ("no journal yet") from response.ok===false ("load failed") so a real auth/network/
// backend failure isn't misreported as empty state (Codex review iter 1). Crude alerts pending a toast composable.

import { ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

interface LatestDailyResult {
  path: string;
  isoDate: string;
}

export function useLatestDaily() {
  const router = useRouter();
  const { t } = useI18n();
  const loading = ref(false);

  async function openLatestDaily(): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    try {
      const response = await apiGet<LatestDailyResult | null>(API_ROUTES.journal.latestDaily);
      if (!response.ok) {
        window.alert(t("sidebarHeader.todayJournalLoadFailed", { status: response.status, error: response.error }));
        return;
      }
      if (response.data === null) {
        window.alert(t("sidebarHeader.todayJournalNotFound"));
        return;
      }
      await router.push(`/files/${response.data.path}`);
    } finally {
      loading.value = false;
    }
  }

  return { openLatestDaily, loading };
}
