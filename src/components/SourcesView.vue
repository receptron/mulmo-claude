<template>
  <SourcesManager mode="page" />
</template>

<script setup lang="ts">
import { nextTick, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import SourcesManager from "./SourcesManager.vue";
import { scrollIntoViewByTestId } from "../utils/dom/scrollIntoViewByTestId";

// Permalink support (#762): arrivals on /sources/:slug scroll and
// flash the matching source row. SourcesManager fetches the list
// asynchronously and renders `source-row-<slug>` testids per row,
// so we retry a couple of times while the API settles before
// giving up — avoids a race on first mount when the fetch hasn't
// resolved yet.
const MAX_RETRIES = 10;
const RETRY_INTERVAL_MS = 150;

const route = useRoute();

async function focusUrlSlug(slug: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    await nextTick();
    if (scrollIntoViewByTestId(`source-row-${slug}`)) return;
    await new Promise((resolve) => window.setTimeout(resolve, RETRY_INTERVAL_MS));
  }
}

onMounted(() => {
  const { slug } = route.params;
  if (typeof slug === "string" && slug) {
    void focusUrlSlug(slug);
  }
});

watch(
  () => route.params.slug,
  (slug) => {
    if (typeof slug === "string" && slug) {
      void focusUrlSlug(slug);
    }
  },
);
</script>
