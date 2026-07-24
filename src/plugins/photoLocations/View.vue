<script setup lang="ts">
// Photo-locations View (#1222 PR-B). A list of every captured
// sidecar — photo path, lat/lng, takenAt, camera. The map handoff
// is by chat (the LLM calls `mapControl({action: "addMarker", lat,
// lng})` once asked) rather than embedded here, so this view stays
// small + always-loadable regardless of whether the user has a
// Google Maps API key set.

import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { apiPost } from "../../utils/api";
import { pluginEndpoints } from "../api";
import type { ResolvedRoute } from "../meta-types";
import { errorMessage as toErrorMessage } from "../../utils/errors";
import { fmtCoord, fmtAltitude, fmtTakenAt, hasValidCoords } from "./format";

interface Sidecar {
  version: 1;
  photo: { relativePath: string; mimeType: string };
  exif: {
    lat?: number;
    lng?: number;
    altitude?: number;
    takenAt?: string;
    make?: string;
    model?: string;
    lens?: string;
  };
  capturedAt: string;
}

interface ListedSidecar {
  id: string;
  relativePath: string;
  sidecar: Sidecar;
}

interface ListResult {
  message?: string;
  data?: { locations: ListedSidecar[]; total: number };
}

interface PhotoLocationsEndpoints {
  dispatch: ResolvedRoute;
}

const { t } = useI18n();
const endpoints = pluginEndpoints<PhotoLocationsEndpoints>("photoLocations");

const locations = ref<ListedSidecar[]>([]);
const loading = ref(true);
const errorMessage = ref<string>("");

async function refresh(): Promise<void> {
  loading.value = true;
  errorMessage.value = "";
  try {
    const result = await apiPost<ListResult>(endpoints.dispatch.url, { kind: "list" });
    if (!result.ok) throw new Error(result.error);
    locations.value = result.data.data?.locations ?? [];
  } catch (err) {
    errorMessage.value = toErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

const withGps = computed(() => locations.value.filter((row) => hasValidCoords(row.sidecar.exif)));

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="photo-locations-view">
    <header>
      <h2>{{ t("photoLocations.title") }}</h2>
      <span class="count" data-testid="photo-locations-count">{{ t("photoLocations.summary", { total: locations.length, withGps: withGps.length }) }}</span>
    </header>

    <p class="hint">{{ t("photoLocations.mapHint") }}</p>

    <div v-if="loading" class="message loading">{{ t("photoLocations.loading") }}</div>
    <div v-else-if="errorMessage" class="message error">⚠ {{ errorMessage }}</div>
    <div v-else-if="locations.length === 0" class="message empty">{{ t("photoLocations.empty") }}</div>

    <ul v-else class="rows">
      <li v-for="row in locations" :key="row.id" class="row" :data-testid="`photo-locations-row-${row.id}`">
        <div class="row-main">
          <code class="path">{{ row.sidecar.photo.relativePath }}</code>
          <span class="taken">{{ fmtTakenAt(row.sidecar.exif.takenAt) }}</span>
        </div>
        <div class="row-meta">
          <span v-if="hasValidCoords(row.sidecar.exif)" class="coords">
            <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- coordinates emoji + decimal pair + altitude unit are language-neutral numeric formatters, not user-facing prose -->
            📍 {{ fmtCoord(row.sidecar.exif.lat) }}, {{ fmtCoord(row.sidecar.exif.lng) }}
            <span v-if="fmtAltitude(row.sidecar.exif.altitude)" class="altitude">({{ fmtAltitude(row.sidecar.exif.altitude) }}m)</span>
            <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
          </span>
          <span v-else class="no-gps">{{ t("photoLocations.noGps") }}</span>
          <span v-if="row.sidecar.exif.model" class="camera">{{ row.sidecar.exif.model }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.photo-locations-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  font-family: system-ui, sans-serif;
  overflow-y: auto;
}
header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}
h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #1f2937;
}
.count {
  font-size: 0.75rem;
  color: #6b7280;
}
.hint {
  margin: 0;
  font-size: 0.75rem;
  color: #6b7280;
  font-style: italic;
}
.message {
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
}
.message.loading,
.message.empty {
  color: #6b7280;
}
.message.error {
  background: #fee2e2;
  border: 1px solid #fecaca;
  color: #991b1b;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.row {
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
}
.row-main {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: baseline;
}
.path {
  font-family: Consolas, "MS Gothic", "BIZ UDGothic", monospace;
  font-size: 0.75rem;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.taken {
  font-size: 0.75rem;
  color: #6b7280;
  flex-shrink: 0;
}
.row-meta {
  margin-top: 0.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #4b5563;
}
.coords {
  font-family: Consolas, "MS Gothic", "BIZ UDGothic", monospace;
}
.altitude {
  color: #9ca3af;
}
.no-gps {
  color: #d97706;
  font-style: italic;
}
.camera {
  color: #6b7280;
}
</style>
