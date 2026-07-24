// Wire @mulmoclaude/collection-plugin/vue to MulmoClaude's collection REST API,
// router, asset-URL scheme, and confirm/shortcut stores. Imported for side effect
// at app startup (src/main.ts) so the package's View layer can resolve data,
// navigate, and render. MulmoTerminal has its own equivalent shim.
//
// Almost everything is wired here at module load: the api helpers, the router
// *instance* (so routing needs no component context), and the module-global
// confirm/shortcut stores. Two capabilities depend on Vue `inject` /
// `onUnmounted` (useAppApi, useNotifications) and so can't run at module load —
// they're deferred behind `installCollectionAppBindings`, which App.vue calls in
// its setup (see App.vue). Until it does, `startChat` is a no-op and
// `notifiedSeverities` returns an empty map.
import {
  configureCollectionUi,
  type CollectionRemoteViewResult,
  type CollectionRemoteViewMutateResult,
  type CollectionRemoteViewItemsResult,
  type CollectionViewI18nResult,
  type CollectionViewToken,
  type RegistryListResponse,
  type RegistryImportResponse,
} from "@mulmoclaude/collection-plugin/vue";
// The package's compiled Tailwind classes — the library build extracts the SFCs'
// styles into this file rather than injecting them, and node_modules isn't in
// this host's Tailwind content scan, so the classes must be loaded explicitly.
import "@mulmoclaude/collection-plugin/style.css";
import { apiDelete, apiFetchRaw, apiGet, apiPost, apiPut } from "../../utils/api";
import { usePubSub } from "../usePubSub";
import { collectionChannel } from "../../config/pubsubChannels";
import { API_ROUTES } from "../../config/apiRoutes";
import { PAGE_ROUTES } from "../../router/pageRoutes";
import { BUILTIN_ROLE_IDS } from "../../config/roles";
import { unref } from "vue";
import router from "../../router/index";
import hostI18n from "../../lib/vue-i18n";
import { htmlPreviewUrlFor, svgPreviewUrlFor } from "../useContentDisplay";
import { isValidFilePath } from "../useFileSelection";
import { resolveImageSrc, setFilesRawUrl } from "@mulmoclaude/markdown-utils/image/resolve";
import { buildCustomViewSrcdoc } from "../../utils/html/customViewSrcdoc";
import { cspExtra, loadCspExtra } from "../useCspExtra";
import { registerViewNonce } from "../useCspViolations";
import { useConfirm } from "../useConfirm";
import { useShortcuts } from "../useShortcuts";
import PinToggle from "../../components/PinToggle.vue";
import type { NotifierSeverity } from "../../utils/collections/notifiedItems";
import type { CollectionsListResponse, CollectionOntologyResponse, FeedsListResponse } from "@mulmoclaude/core/collection";
import type { TranslateResponse } from "@mulmoclaude/core/translation/client";
import type { CollectionDetailResponse, ItemMutationResponse } from "../../components/collectionTypes";

// @mulmoclaude/markdown-utils resolves workspace-relative image paths against a
// module-global URL that defaults to "/api/files/raw"; point it at API_ROUTES so
// that stays the single source of truth (MulmoTerminal overrides it likewise).
setFilesRawUrl(API_ROUTES.files.raw);

const { openConfirm } = useConfirm();
// NOTE: useShortcuts() is resolved lazily inside the unpin/reconcile capabilities
// below, NOT here. Calling it eagerly at module-eval would trigger the store's
// load() before main.ts runs setAuthToken(), firing /api/shortcuts without a
// bearer on cold boot. By call time (a pin/reconcile from a mounted view) auth is set.

// ── URL builders (mirror the route templates in API_ROUTES.collections) ──
const withSlug = (route: string, slug: string): string => route.replace(":slug", encodeURIComponent(slug));
const itemUrl = (slug: string, itemId: string): string => withSlug(API_ROUTES.collections.item, slug).replace(":itemId", encodeURIComponent(itemId));
const itemActionUrl = (slug: string, itemId: string, actionId: string): string =>
  withSlug(API_ROUTES.collections.itemAction, slug).replace(":itemId", encodeURIComponent(itemId)).replace(":actionId", encodeURIComponent(actionId));
const collectionActionUrl = (slug: string, actionId: string): string =>
  withSlug(API_ROUTES.collections.collectionAction, slug).replace(":actionId", encodeURIComponent(actionId));
const viewDeleteUrl = (slug: string, viewId: string): string =>
  withSlug(API_ROUTES.collections.viewDelete, slug).replace(":viewId", encodeURIComponent(viewId));
const remoteViewMutateUrl = (slug: string, viewId: string): string =>
  withSlug(API_ROUTES.collections.remoteViewMutate, slug).replace(":viewId", encodeURIComponent(viewId));
const remoteViewItemsUrl = (slug: string, viewId: string): string =>
  withSlug(API_ROUTES.collections.remoteViewItems, slug).replace(":viewId", encodeURIComponent(viewId));

// ── Deferred app bindings (need a component context; set by App.vue setup) ──
type StartChat = (prompt: string, role: string) => void;
type StartChatDraft = (prompt: string, role?: string) => void;
type NotifiedSeverities = (slug: string) => Map<string, NotifierSeverity>;
let startChatFn: StartChat | null = null;
let startChatDraftFn: StartChatDraft | null = null;
let notifiedSeveritiesFn: NotifiedSeverities | null = null;

/** Called once from App.vue's setup, where `useAppApi()` / `useNotifications()`
 *  resolve. Wires the capabilities that can't be set at module load. */
export function installCollectionAppBindings(bindings: {
  startChat: StartChat;
  startNewChatDraft: StartChatDraft;
  notifiedSeverities: NotifiedSeverities;
}): void {
  startChatFn = bindings.startChat;
  startChatDraftFn = bindings.startNewChatDraft;
  notifiedSeveritiesFn = bindings.notifiedSeverities;
}

configureCollectionUi({
  fetchCollectionDetail: (slug) => apiGet<CollectionDetailResponse>(withSlug(API_ROUTES.collections.detail, slug)),
  fileAssetUrl: (value) => (isValidFilePath(value) ? (htmlPreviewUrlFor(value) ?? svgPreviewUrlFor(value)) : null),
  fileRoutePath: (value) => (isValidFilePath(value) ? `/files/${value.split("/").map(encodeURIComponent).join("/")}` : null),
  imageSrc: (imageData) => resolveImageSrc(imageData),
  confirm: (options) => openConfirm(options),
  deleteView: (slug, viewId) => apiDelete(viewDeleteUrl(slug, viewId)),
  mintViewToken: (slug, viewId) => apiPost<CollectionViewToken>(withSlug(API_ROUTES.collections.viewToken, slug), { viewId }),
  fetchViewHtml: async (slug, viewId) => {
    try {
      // Refresh the CSP extension so a `config/csp.json` edit takes effect on
      // the next view open (not only after an app reload) — the srcdoc CSP is
      // built client-side from the cached `cspExtra` a moment later. Best-effort.
      await loadCspExtra();
      const resp = await apiFetchRaw(withSlug(API_ROUTES.collections.viewFile, slug), { query: { id: viewId } });
      return resp.ok ? { ok: true, html: await resp.text() } : { ok: false, status: resp.status };
    } catch {
      // Network / abort error — surface a typed failure (status 0) like the
      // host's apiCall helpers do, so the custom-view loader shows "HTTP 0"
      // rather than rejecting.
      return { ok: false, status: 0 };
    }
  },
  fetchViewI18n: (slug, viewId, locale) => apiGet<CollectionViewI18nResult>(withSlug(API_ROUTES.collections.viewI18n, slug), { id: viewId, locale }),
  fetchRemoteView: (slug, viewId, locale) => apiGet<CollectionRemoteViewResult>(withSlug(API_ROUTES.collections.remoteView, slug), { id: viewId, locale }),
  mutateRemoteView: (slug, viewId, request) => apiPost<CollectionRemoteViewMutateResult>(remoteViewMutateUrl(slug, viewId), request),
  fetchRemoteViewItems: (slug, viewId, request) =>
    apiGet<CollectionRemoteViewItemsResult>(remoteViewItemsUrl(slug, viewId), {
      offset: request.offset,
      limit: request.limit,
      fields: request.fields?.join(",") || undefined,
    }),
  buildViewSrcdoc: (html, boot) => {
    // Per-render nonce: only a violation report echoing this exact nonce is
    // trusted by the host collector, so a nested hostile iframe can't spoof it.
    const nonce = crypto.randomUUID();
    registerViewNonce(nonce);
    return buildCustomViewSrcdoc(html, boot, cspExtra.value, nonce);
  },

  // record CRUD + actions
  createItem: (slug, record) => apiPost<ItemMutationResponse>(withSlug(API_ROUTES.collections.items, slug), record),
  updateItem: (slug, itemId, record) => apiPut<ItemMutationResponse>(itemUrl(slug, itemId), record),
  deleteItem: (slug, itemId) => apiDelete(itemUrl(slug, itemId)),
  deleteCollection: (slug) => apiDelete(withSlug(API_ROUTES.collections.detail, slug)),
  deleteFeed: (slug) => apiDelete(withSlug(API_ROUTES.feeds.detail, slug)),
  runItemAction: (slug, itemId, actionId, params) => apiPost(itemActionUrl(slug, itemId, actionId), params ? { params } : {}),
  runCollectionAction: (slug, actionId) => apiPost(collectionActionUrl(slug, actionId), {}),
  refreshCollection: (slug) => apiPost(withSlug(API_ROUTES.collections.refresh, slug), {}),

  // routing (via the router instance — reactive through router.currentRoute)
  routeSlug: () => (typeof router.currentRoute.value.params.slug === "string" ? router.currentRoute.value.params.slug : undefined),
  routeSelectedId: () => (typeof router.currentRoute.value.query.selected === "string" ? router.currentRoute.value.query.selected : undefined),
  isFeedRoute: () => router.currentRoute.value.name === PAGE_ROUTES.feeds,
  setSelectedId: (itemId) => {
    const query = { ...router.currentRoute.value.query };
    if (itemId === null) delete query.selected;
    else query.selected = itemId;
    router.replace({ query }).catch(() => {});
  },
  gotoIndex: (kind) => {
    router.push({ name: kind === "feed" ? PAGE_ROUTES.feeds : PAGE_ROUTES.collections, params: {} }).catch(() => {});
  },
  gotoDetail: (kind, slug) => {
    router.push({ name: kind === "feed" ? PAGE_ROUTES.feeds : PAGE_ROUTES.collections, params: { slug } }).catch(() => {});
  },
  navigateToRecord: (targetSlug, recordId) => {
    router.push({ name: PAGE_ROUTES.collections, params: { slug: targetSlug }, query: recordId !== undefined ? { selected: recordId } : {} }).catch(() => {});
  },
  recordHref: (targetSlug, recordId) => {
    const base = `/collections/${encodeURIComponent(targetSlug)}`;
    return recordId !== undefined ? `${base}?selected=${encodeURIComponent(recordId)}` : base;
  },
  navigate: (path) => {
    router.push(path).catch(() => {});
  },

  // index pages
  listCollections: () => apiGet<CollectionsListResponse>(API_ROUTES.collections.list),
  listFeeds: () => apiGet<FeedsListResponse>(API_ROUTES.feeds.list),
  fetchOntology: () => apiGet<CollectionOntologyResponse>(API_ROUTES.collections.ontology),
  listRegistry: () => apiGet<RegistryListResponse>(API_ROUTES.collectionsRegistry.list),
  importRegistry: (author, slug, registry) => apiPost<RegistryImportResponse>(API_ROUTES.collectionsRegistry.import, { author, slug, registry }),
  reconcileShortcuts: (kind, live) => useShortcuts().reconcile(kind, live),

  // app integration
  // `i18n.global.locale` is typed as a string but is actually a Ref at runtime
  // (the host runs vue-i18n in composition mode); `unref` returns the tag either way.
  localeTag: () => unref(hostI18n.global.locale),
  startChat: (prompt, role) => startChatFn?.(prompt, role),
  startNewChatDraft: (prompt, role) => startChatDraftFn?.(prompt, role),
  generalRoleId: BUILTIN_ROLE_IDS.general,
  personalRoleId: BUILTIN_ROLE_IDS.personal,
  unpin: (kind, slug) => useShortcuts().unpin(kind, slug),
  notifiedSeverities: (slug) => notifiedSeveritiesFn?.(slug) ?? new Map<string, NotifierSeverity>(),
  // Live record-change subscription. `usePubSub().subscribe` is context-free
  // (module-level socket), so this works when invoked from a view's setup; the
  // view owns the returned unsubscribe (onUnmounted). The payload is ignored —
  // subscribers refetch — so the callback is parameterless.
  subscribeChanges: (slug, onChange) => usePubSub().subscribe(collectionChannel(slug), () => onChange()),

  pinToggle: PinToggle,

  // Runtime translation of UI strings (collection starter cards) — same route
  // and bearer the host's role-query chips use; `null` on any failure so the
  // view falls back to English.
  translate: (req) => apiPost<TranslateResponse>(API_ROUTES.translation.translate, req).then((result) => (result.ok ? result.data : null)),
});
