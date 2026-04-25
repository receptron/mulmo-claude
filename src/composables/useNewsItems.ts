// Composable: aggregate recent news items via /api/news/items.
// Mirrors the server-side `NewsItem` shape from
// `server/workspace/news/reader.ts`. Re-declared here so the
// frontend doesn't pull a server import.

import { ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet } from "../utils/api";

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  categories: string[];
  sourceSlug: string;
  severity?: string;
}

export function useNewsItems() {
  const items = ref<NewsItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(days = 30): Promise<void> {
    loading.value = true;
    error.value = null;
    const result = await apiGet<{ items: NewsItem[] }>(`${API_ROUTES.news.items}?days=${days}`);
    loading.value = false;
    if (!result.ok) {
      error.value = result.error;
      return;
    }
    items.value = result.data.items;
  }

  return { items, loading, error, load };
}
