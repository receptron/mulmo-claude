// Top-bar "today's journal" shortcut wiring (#876).
//
// Calls GET /api/journal/latest-daily, then either navigates to the
// returned md path through FilesView, or surfaces a notice via
// window.alert. Three terminal states, each with its own user copy:
//   - data is a path  → navigate to /files/<path>
//   - data is null    → "no journal yet" (legitimate empty state)
//   - response.ok=false → "load failed" with status code so a real
//     auth/network/backend failure isn't silently misreported as
//     "no journal yet" (Codex review iter 1)
//
// The alert is intentionally crude for v1 — a proper in-app toast
// composable doesn't exist yet (see plans/feat-today-journal-shortcut.md
// "Out of scope"). When that lands, swap the alert calls for the
// toast helper without touching the branching above.

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
      // FilesView route is `/files/<workspace-relative-path>`; the
      // path returned by the API is already workspace-relative
      // (e.g. "conversations/summaries/daily/2026/04/26.md").
      await router.push(`/files/${response.data.path}`);
    } finally {
      loading.value = false;
    }
  }

  return { openLatestDaily, loading };
}
