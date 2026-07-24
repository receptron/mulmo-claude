<template>
  <div class="remote-preview-container" data-testid="collection-remote-view-preview">
    <div v-if="error" class="remote-preview-message" role="alert" data-testid="collection-remote-view-error">
      {{ t("collectionsView.customViewError", { error }) }}
    </div>
    <div v-else-if="loading" class="remote-preview-message" data-testid="collection-remote-view-loading">
      {{ t("collectionsView.customViewLoading") }}
    </div>
    <template v-else-if="srcdoc">
      <!-- Same sandbox as CollectionCustomView: NO `allow-same-origin` (opaque
           origin — the view can't read the parent's storage; here there is no
           token to protect, but the phone renders under the same rules and the
           preview must match it exactly). `allow-popups*` lets outbound
           `target="_blank"` links open as normal tabs. `allow-downloads` lets
           a view save files (e.g. an .ics iCalendar export); the phone grants
           it too, so the preview must match. -->
      <div class="phone-frame">
        <iframe
          ref="iframeEl"
          :key="view.id"
          data-testid="collection-remote-view-iframe"
          :title="view.label"
          :srcdoc="srcdoc"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads"
          class="phone-screen"
        />
      </div>
      <!-- Numeric on purpose (no locale keys): the srcdoc's size against the
           1 MiB command-document budget it must travel through. -->
      <div class="remote-preview-caption" data-testid="collection-remote-view-size">{{ sizeCaption }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useCollectionI18n } from "../lang";
import { errorMessage } from "@mulmoclaude/core/collection";
import type { CollectionCustomView } from "@mulmoclaude/core/collection";
import {
  handleRemoteViewMessage,
  REMOTE_VIEW_MAX_BYTES,
  type RemoteViewItem,
  type RemoteViewMutateRequest,
  type RemoteViewMutateResult,
  type RemoteViewPage,
  type RemoteViewPageRequest,
} from "@mulmoclaude/core/remote-view";
import { collectionUi } from "../uiContext";

const { t } = useCollectionI18n();

const props = defineProps<{
  slug: string;
  view: CollectionCustomView;
}>();

const emit = defineEmits<{
  /** The view called `__MC_VIEW.startChat(prompt, role)` — open a new chat
   *  with `prompt` prefilled as an editable draft (host validates `role`). */
  startChat: [payload: { prompt: string; role?: string }];
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const srcdoc = ref<string | null>(null);
const bytes = ref(0);
const iframeEl = ref<HTMLIFrameElement | null>(null);
// Last page's inlined/omitted image counts — surfaced so the author sees how
// many thumbnails fit the per-page budget while iterating (numeric, no locale
// keys, like the byte caption).
const imageStats = ref<{ inlined: number; omitted: number } | null>(null);

const sizeCaption = computed(() => {
  const base = `${Math.max(1, Math.round(bytes.value / 1024))} KB / ${Math.round(REMOTE_VIEW_MAX_BYTES / 1024)} KB`;
  const stats = imageStats.value;
  if (!stats || (stats.inlined === 0 && stats.omitted === 0)) return base;
  return stats.omitted > 0 ? `${base} · ${stats.inlined} images (${stats.omitted} over budget)` : `${base} · ${stats.inlined} images`;
});

// Monotonic load id — same stale-load guard as CollectionCustomView.
let loadSeq = 0;

async function load(): Promise<void> {
  const seq = ++loadSeq;
  const stale = (): boolean => seq !== loadSeq;
  loading.value = true;
  error.value = null;
  srcdoc.value = null;
  const binding = collectionUi();
  try {
    // The host wraps the srcdoc server-side (CSP + bootstrap) — the preview
    // receives the exact artifact the phone gets over the command channel.
    const resp = await binding.fetchRemoteView?.(props.slug, props.view.id, binding.localeTag());
    if (stale()) return;
    if (!resp) {
      error.value = "fetchRemoteView is not wired on this host";
      return;
    }
    if (!resp.ok) {
      error.value = resp.error;
      return;
    }
    bytes.value = resp.data.bytes;
    srcdoc.value = resp.data.srcdoc;
  } catch (err) {
    if (!stale()) error.value = errorMessage(err);
  } finally {
    if (!stale()) loading.value = false;
  }
}

// Reload when the view / collection / app locale changes (the dict is picked
// server-side per locale, like the desktop custom view).
watch([() => props.slug, () => props.view.id, () => collectionUi().localeTag()], () => void load(), { immediate: true });

// ── The parent side of the remote-view bridge ──
// Answers ONLY what the phone parent answers — `getItems` pages and `startChat`
// relays. No `onChange`, no `openItem`: preview capability must equal phone
// capability exactly (plans/done/feat-remote-custom-view.md, decision 5).
//
// Paging goes through the HOST (not client-side over the records) because the
// page's declared `imageFields` are inlined as `data:` URL thumbnails the
// browser can neither read from the workspace nor resize — the preview fetches
// the same host page (real thumbnails, byte budget) the phone will, over the
// identical `createRemoteViewItems` builder (plans/done/feat-remote-view-images.md).
async function getPage(request: RemoteViewPageRequest): Promise<RemoteViewPage> {
  const binding = collectionUi();
  if (!binding.fetchRemoteViewItems) throw new Error("fetchRemoteViewItems is not wired on this host");
  const resp = await binding.fetchRemoteViewItems(props.slug, props.view.id, request);
  if (!resp.ok) throw new Error(resp.error);
  imageStats.value = { inlined: resp.data.inlined, omitted: resp.data.omitted };
  return resp.data.page;
}

// A preview mutation is a REAL host write, through the same builder + policy the
// phone will run (plans/done/feat-remote-writable-view.md, decision 4). The write
// publishes a collection-change event, so the parent's live subscription
// refetches `props.items` and the view's next `getItems` reflects it. A refused
// mutate (read-only / non-editable field / …) throws the host's message, which
// the bridge relays to the view as `ok: false`.
async function onMutate(request: RemoteViewMutateRequest): Promise<RemoteViewMutateResult> {
  const binding = collectionUi();
  if (!binding.mutateRemoteView) throw new Error("mutateRemoteView is not wired on this host");
  const resp = await binding.mutateRemoteView(props.slug, props.view.id, request);
  if (!resp.ok) throw new Error(resp.error);
  return resp.data.op === "update" ? { item: resp.data.item as RemoteViewItem } : { id: resp.data.id };
}

function onWindowMessage(event: MessageEvent): void {
  const target = event.source;
  if (!target || target !== iframeEl.value?.contentWindow) return;
  void handleRemoteViewMessage(
    event.data,
    {
      slug: props.slug,
      getPage,
      onMutate,
      onStartChat: (prompt, role) => emit("startChat", { prompt, role }),
    },
    // targetOrigin "*": the sandboxed document's origin is opaque, nothing
    // else can match; the page carries the user's own records to the user's
    // own view.
    (message) => target.postMessage(message, "*"),
  );
}

onMounted(() => window.addEventListener("message", onWindowMessage));
onBeforeUnmount(() => window.removeEventListener("message", onWindowMessage));
</script>

<style scoped>
.remote-preview-container {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  background: #f1f5f9;
  overflow: hidden;
}

/* A phone-sized (390×844 CSS px) frame; shrinks with the panel but never
   grows past phone dimensions, so layouts are judged at the real size. */
.phone-frame {
  width: 390px;
  height: 844px;
  max-width: 100%;
  max-height: calc(100% - 28px);
  min-height: 0;
  flex-shrink: 1;
  border: 8px solid #0f172a;
  border-radius: 28px;
  overflow: hidden;
  background: white;
}

.phone-screen {
  width: 100%;
  height: 100%;
  border: 0;
}

.remote-preview-caption {
  font-size: 12px;
  color: #64748b;
}

.remote-preview-message {
  padding: 1rem;
  font-size: 0.875rem;
  color: #64748b;
}

[role="alert"].remote-preview-message {
  color: #b71c1c;
}
</style>
