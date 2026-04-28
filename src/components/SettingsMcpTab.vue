<template>
  <div class="space-y-3">
    <i18n-t keypath="settingsMcpTab.explanation" tag="p" class="text-xs text-gray-600 leading-relaxed">
      <template #npx><code class="bg-gray-100 px-1 rounded">npx</code></template>
      <template #node><code class="bg-gray-100 px-1 rounded">node</code></template>
      <template #tsx><code class="bg-gray-100 px-1 rounded">tsx</code></template>
    </i18n-t>

    <!-- Catalog (#823 Phase 1) — checkbox install for curated MCP servers.
         Phase 1 ships only config-free entries; per-server config (api keys
         etc.) lands in Phase 2. -->
    <section data-testid="mcp-catalog" class="space-y-2 pt-1">
      <h3 class="text-xs font-semibold text-gray-700">{{ t("settingsMcpTab.catalog.heading") }}</h3>

      <details class="group" open data-testid="mcp-catalog-audience-general">
        <summary class="cursor-pointer text-xs font-medium text-gray-700 select-none py-1">
          {{ t("settingsMcpTab.catalog.audience.general") }}
          <span class="text-gray-400 ml-1">({{ generalEntries.length }})</span>
        </summary>
        <ul class="mt-2 space-y-2">
          <li
            v-for="entry in generalEntries"
            :key="entry.id"
            :data-testid="`mcp-catalog-entry-${entry.id}`"
            class="border border-gray-200 rounded p-3 space-y-1.5"
          >
            <label class="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                :checked="isInstalled(entry.id)"
                :data-testid="`mcp-catalog-toggle-${entry.id}`"
                class="mt-1 shrink-0"
                @change="onCatalogToggle(entry, $event)"
              />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-sm font-semibold text-gray-800">{{ t(entry.displayName) }}</span>
                  <span class="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5" :class="riskBadgeClass(entry.riskLevel)">
                    {{ t(`settingsMcpTab.catalog.risk.${entry.riskLevel}`) }}
                  </span>
                </div>
                <p class="text-xs text-gray-600 mt-0.5">{{ t(entry.description) }}</p>
              </div>
            </label>
            <div class="text-[11px] text-gray-500 flex flex-wrap gap-x-3 ml-6">
              <a
                :href="entry.upstreamUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="hover:text-blue-600 hover:underline"
                :data-testid="`mcp-catalog-upstream-${entry.id}`"
                v-text="t('settingsMcpTab.catalog.upstream')"
              ></a>
              <a
                v-if="entry.setupGuideUrl"
                :href="entry.setupGuideUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="hover:text-blue-600 hover:underline"
                :data-testid="`mcp-catalog-setup-${entry.id}`"
                v-text="t('settingsMcpTab.catalog.setupGuide')"
              ></a>
            </div>

            <!-- Per-server config form (Phase 2). Only the entry being
                 actively configured renders the form; toggling a different
                 entry on closes this one. -->
            <form
              v-if="configFormEntryId === entry.id"
              :data-testid="`mcp-catalog-config-form-${entry.id}`"
              class="ml-6 mt-2 space-y-3 border-l-2 border-blue-200 pl-3"
              @submit.prevent="onConfigFormInstall(entry)"
            >
              <div v-for="field in entry.configSchema" :key="field.key" class="space-y-1">
                <div class="flex items-center gap-1.5">
                  <label :for="`mcp-config-${entry.id}-${field.key}`" class="text-xs font-medium text-gray-700">
                    {{ t(field.label) }}
                    <span v-if="field.required" class="text-red-500" :aria-label="t('settingsMcpTab.catalog.config.requiredAria')">{{
                      t("settingsMcpTab.catalog.config.requiredMarker")
                    }}</span>
                  </label>
                  <a
                    v-if="field.helpUrl"
                    :href="field.helpUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-xs text-blue-600 hover:underline"
                    :title="t('settingsMcpTab.catalog.config.howToGet')"
                    :aria-label="t('settingsMcpTab.catalog.config.howToGet')"
                    :data-testid="`mcp-catalog-config-help-${entry.id}-${field.key}`"
                  >
                    🔑
                  </a>
                </div>
                <!-- No HTML `required` attribute — empty-field
                     validation is handled by interpolateMcpSpec()
                     so the inline error block stays the single
                     source of truth (and so the e2e can submit an
                     empty form to exercise the validation path). -->
                <select
                  v-if="field.kind === 'select'"
                  :id="`mcp-config-${entry.id}-${field.key}`"
                  v-model="configFormValues[field.key]"
                  :aria-required="field.required"
                  :class="['w-full px-2 py-1 text-xs border rounded', configFormErrors.includes(field.key) ? 'border-red-400 bg-red-50' : 'border-gray-300']"
                  :data-testid="`mcp-catalog-config-input-${entry.id}-${field.key}`"
                >
                  <option v-if="!field.required" value="">{{ field.placeholder ?? "" }}</option>
                  <option v-for="option in field.options ?? []" :key="option" :value="option">{{ option }}</option>
                </select>
                <input
                  v-else
                  :id="`mcp-config-${entry.id}-${field.key}`"
                  v-model="configFormValues[field.key]"
                  :type="configFieldInputType(field)"
                  :placeholder="field.placeholder ?? ''"
                  :aria-required="field.required"
                  :class="['w-full px-2 py-1 text-xs border rounded', configFormErrors.includes(field.key) ? 'border-red-400 bg-red-50' : 'border-gray-300']"
                  :data-testid="`mcp-catalog-config-input-${entry.id}-${field.key}`"
                  autocomplete="off"
                  spellcheck="false"
                />
                <p v-if="field.helpText" class="text-[11px] text-gray-500">{{ t(field.helpText) }}</p>
              </div>
              <div v-if="configFormErrors.length > 0" class="text-xs text-red-600" :data-testid="`mcp-catalog-config-error-${entry.id}`">
                {{ t("settingsMcpTab.catalog.config.errMissingRequired", { fields: configFormErrors.join(", ") }) }}
              </div>
              <div class="flex gap-2 justify-end">
                <button
                  type="button"
                  class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  :data-testid="`mcp-catalog-config-cancel-${entry.id}`"
                  @click="onConfigFormCancel"
                >
                  {{ t("common.cancel") }}
                </button>
                <button
                  type="submit"
                  class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600"
                  :data-testid="`mcp-catalog-config-install-${entry.id}`"
                >
                  {{ t("settingsMcpTab.catalog.config.install") }}
                </button>
              </div>
            </form>
          </li>
        </ul>
      </details>
    </section>

    <hr class="border-gray-200" />

    <h3 class="text-xs font-semibold text-gray-700">{{ t("settingsMcpTab.customHeading") }}</h3>

    <div v-if="servers.length === 0" class="text-xs text-gray-500 italic" data-testid="mcp-empty">{{ t("settingsMcpTab.noServers") }}</div>

    <ul v-else class="space-y-2" data-testid="mcp-server-list">
      <li
        v-for="(entry, idx) in servers"
        :key="entry.id + ':' + idx"
        class="border border-gray-200 rounded p-3 space-y-2"
        :data-testid="'mcp-server-' + entry.id"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-gray-800">{{ entry.id }}</span>
            <span
              class="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5"
              :class="entry.spec.type === 'http' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'"
              >{{ entry.spec.type }}</span
            >
            <label class="flex items-center gap-1 text-xs text-gray-600 ml-2">
              <input type="checkbox" :checked="entry.spec.enabled !== false" :data-testid="'mcp-enabled-' + entry.id" @change="onToggleEnabled(idx, $event)" />
              {{ t("settingsMcpTab.enabled") }}
            </label>
          </div>
          <button class="text-xs text-red-600 hover:text-red-800" :data-testid="'mcp-remove-' + entry.id" @click="emit('remove', idx)">
            {{ t("common.remove") }}
          </button>
        </div>
        <div v-if="entry.spec.type === 'http'" class="text-xs space-y-1">
          <div>
            <span class="text-gray-500">{{ t("settingsMcpTab.urlLabel") }}</span>
            <code class="ml-1">{{ entry.spec.url }}</code>
          </div>
          <i18n-t
            v-if="dockerMode && wouldRewriteLocalhost((entry.spec as HttpSpec).url)"
            keypath="settingsMcpTab.localhostRewrite"
            tag="div"
            class="text-amber-700"
          >
            <template #localhost><code>localhost</code></template>
            <template #hostDockerInternal><code>host.docker.internal</code></template>
          </i18n-t>
        </div>
        <div v-else-if="entry.spec.type === 'stdio'" class="text-xs space-y-1">
          <div>
            <span class="text-gray-500">{{ t("settingsMcpTab.commandLabel") }}</span>
            <code class="ml-1">{{ entry.spec.command }}</code>
            <code v-if="(entry.spec as StdioSpec).args?.length" class="ml-1">
              {{ ((entry.spec as StdioSpec).args ?? []).join(" ") }}
            </code>
          </div>
          <div
            v-if="dockerMode && stdioHasNonWorkspaceArg((entry.spec as StdioSpec).args)"
            class="text-red-600"
            :data-testid="'mcp-docker-warning-' + entry.id"
          >
            {{ t("settingsMcpTab.dockerNonWorkspaceWarning") }}
          </div>
        </div>
      </li>
    </ul>

    <button v-if="!adding" class="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50" data-testid="mcp-add-btn" @click="startAdd">
      {{ t("settingsMcpTab.addServerButton") }}
    </button>

    <div v-else class="border border-blue-300 rounded p-3 space-y-2" data-testid="mcp-add-form">
      <label class="block text-xs font-semibold text-gray-700">
        {{ t("settingsMcpTab.nameLabel") }}
        <input
          v-model="draft.id"
          type="text"
          :placeholder="t('settingsMcpTab.namePlaceholder')"
          class="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
          data-testid="mcp-draft-id"
          @keydown.stop
        />
      </label>
      <div class="flex gap-3 text-xs">
        <label class="flex items-center gap-1">
          <input v-model="draft.type" type="radio" value="http" data-testid="mcp-draft-type-http" />
          {{ t("settingsMcpTab.typeHttp") }}
        </label>
        <label class="flex items-center gap-1">
          <input v-model="draft.type" type="radio" value="stdio" data-testid="mcp-draft-type-stdio" />
          {{ t("settingsMcpTab.typeStdio") }}
        </label>
      </div>
      <div v-if="draft.type === 'http'" class="space-y-2">
        <label class="block text-xs font-semibold text-gray-700">
          {{ t("settingsMcpTab.urlFieldLabel") }}
          <input
            v-model="draft.url"
            type="text"
            :placeholder="t('settingsMcpTab.urlPlaceholder')"
            class="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            data-testid="mcp-draft-url"
            @keydown.stop
          />
        </label>
      </div>
      <div v-else class="space-y-2">
        <label class="block text-xs font-semibold text-gray-700">
          {{ t("settingsMcpTab.commandFieldLabel") }}
          <select
            v-model="draft.command"
            class="mt-1 w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            data-testid="mcp-draft-command"
          >
            <option value="npx">npx</option>
            <option value="node">node</option>
            <option value="tsx">tsx</option>
          </select>
        </label>
        <label class="block text-xs font-semibold text-gray-700">
          {{ t("settingsMcpTab.argsLabel") }}
          <textarea
            v-model="draft.argsText"
            class="mt-1 w-full h-20 px-2 py-1 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
            :placeholder="t('settingsMcpTab.argsPlaceholder')"
            data-testid="mcp-draft-args"
            @keydown.stop
          ></textarea>
        </label>
      </div>
      <div v-if="draftError" class="text-xs text-red-600" data-testid="mcp-draft-error">
        {{ draftError }}
      </div>
      <div class="flex justify-end gap-2">
        <button class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50" data-testid="mcp-draft-cancel" @click="cancelAdd">
          {{ t("common.cancel") }}
        </button>
        <button class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600" data-testid="mcp-draft-add" @click="commitAdd">
          {{ t("common.add") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

// UI-local representation of a configured server. Matches
// server/config.ts#McpServerEntry. Re-declared in src/config/mcpTypes.ts
// to avoid a cross-module type import from the server package.
import type { HttpSpec, StdioSpec, McpServerSpec, McpServerEntry } from "../config/mcpTypes";
import { MCP_CATALOG, requiredKeysOf, type McpCatalogEntry, type McpConfigField } from "../config/mcpCatalog";
import { interpolateMcpSpec } from "../utils/mcp/interpolateSpec";

const { t } = useI18n();

// Re-exported for callers that imported these from the SFC before the
// types moved out (#823 Phase 1).
export type { HttpSpec, StdioSpec, McpServerSpec, McpServerEntry };
/** @deprecated alias kept for the previous SFC-local name. */
export type ServerSpec = McpServerSpec;

interface Props {
  servers: McpServerEntry[];
  dockerMode: boolean;
}
const props = defineProps<Props>();

const emit = defineEmits<{
  add: [entry: McpServerEntry];
  update: [index: number, entry: McpServerEntry];
  remove: [index: number];
}>();

interface DraftState {
  id: string;
  type: "http" | "stdio";
  url: string;
  command: string;
  argsText: string;
}

const adding = ref(false);
const draft = ref<DraftState>(emptyDraft());
const draftError = ref("");

// ── Catalog (#823 Phase 1) ─────────────────────────────────────
//
// Catalog membership is derived from `props.servers`: a checkbox is
// "on" iff a custom server with the same id already exists. Toggle
// emits `add` (with the catalog spec) or `remove` (by index) — the
// parent owns persistence.
//
// Phase 1 only renders General audience. Developer entries are
// out-of-band until Phase 3.

const generalEntries = computed(() => MCP_CATALOG.filter((entry) => entry.audience === "general"));

function isInstalled(serverId: string): boolean {
  return props.servers.some((server) => server.id === serverId);
}

function onCatalogToggle(entry: McpCatalogEntry, event: Event): void {
  const { checked } = event.target as HTMLInputElement;
  if (checked) {
    if (entry.configSchema.length > 0) {
      openConfigForm(entry);
      // Visually un-check until the form is submitted; install is gated
      // on the form's required-field validation.
      (event.target as HTMLInputElement).checked = false;
      return;
    }
    emit("add", { id: entry.id, spec: { ...entry.spec, enabled: true } });
    return;
  }
  const idx = props.servers.findIndex((server) => server.id === entry.id);
  if (idx >= 0) emit("remove", idx);
}

// ── Per-server config form (#823 Phase 2) ──────────────────────
//
// Catalog entries with a non-empty `configSchema` open an inline
// form on toggle. The user fills required fields, hits Install, and
// the spec template's `${KEY}` placeholders are interpolated with
// the entered values via `interpolateMcpSpec` before emitting `add`.
//
// Drafted values (NOT installed yet) are stashed in localStorage so
// an accidental Cancel doesn't lose a freshly-pasted API key.
// Persistence ends once the entry installs — values then live in
// the spec env / url where mcp.json (0o600) protects them.

const CONFIG_DRAFT_LS_PREFIX = "mcp-catalog-draft:";
const configFormEntryId = ref<string | null>(null);
const configFormValues = ref<Record<string, string>>({});
const configFormErrors = ref<string[]>([]);

function openConfigForm(entry: McpCatalogEntry): void {
  configFormEntryId.value = entry.id;
  configFormErrors.value = [];
  configFormValues.value = readDraftFromStorage(entry.id);
  // Pre-fill any missing keys with empty strings so reactive bindings
  // work without `v-model` warnings.
  for (const field of entry.configSchema) {
    if (configFormValues.value[field.key] === undefined) configFormValues.value[field.key] = "";
  }
}

function closeConfigForm(): void {
  configFormEntryId.value = null;
  configFormValues.value = {};
  configFormErrors.value = [];
}

function onConfigFormCancel(): void {
  closeConfigForm();
}

function onConfigFormInstall(entry: McpCatalogEntry): void {
  configFormErrors.value = [];
  const result = interpolateMcpSpec(entry.spec, configFormValues.value, requiredKeysOf(entry));
  if (!result.ok) {
    configFormErrors.value = result.missing;
    persistDraftToStorage(entry.id, configFormValues.value, entry.configSchema);
    return;
  }
  emit("add", { id: entry.id, spec: { ...result.spec, enabled: true } });
  // Successful install — drop the draft so we don't leak the API key
  // in localStorage past its useful lifetime.
  clearDraftFromStorage(entry.id);
  closeConfigForm();
}

function readDraftFromStorage(entryId: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(CONFIG_DRAFT_LS_PREFIX + entryId);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function persistDraftToStorage(entryId: string, values: Record<string, string>, schema: McpConfigField[]): void {
  // SECRET HYGIENE (Codex iter-1 #852): never write `kind: "secret"`
  // values to localStorage. Plaintext API keys would survive cancel
  // / reload outside the encrypted mcp.json path and remain
  // recoverable via dev tools / XSS. Non-secret fields (host id,
  // workspace path, etc.) keep their draft so a missing-field
  // re-submission doesn't clobber the user's other typing.
  const secretKeys = new Set(schema.filter((field) => field.kind === "secret").map((field) => field.key));
  const safeValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (secretKeys.has(key)) continue;
    safeValues[key] = value;
  }
  try {
    window.localStorage.setItem(CONFIG_DRAFT_LS_PREFIX + entryId, JSON.stringify(safeValues));
  } catch {
    // localStorage can throw in private browsing or when full — silent
    // no-op; draft just won't survive the page reload.
  }
}

function clearDraftFromStorage(entryId: string): void {
  try {
    window.localStorage.removeItem(CONFIG_DRAFT_LS_PREFIX + entryId);
  } catch {
    // Same rationale as persistDraftToStorage.
  }
}

function configFieldInputType(field: McpConfigField): string {
  // `select` is rendered as a <select> element, not <input>, so this
  // helper is only ever called for input-rendered kinds. `path` falls
  // through to plain text for now — file-picker UX is out of scope
  // for Phase 2 (Codex iter-1 #852, partial).
  if (field.kind === "secret") return "password";
  if (field.kind === "url") return "url";
  return "text";
}

function riskBadgeClass(level: McpCatalogEntry["riskLevel"]): string {
  if (level === "low") return "bg-green-100 text-green-700";
  if (level === "medium") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function emptyDraft(): DraftState {
  return { id: "", type: "http", url: "", command: "npx", argsText: "" };
}

function startAdd(): void {
  draft.value = emptyDraft();
  draftError.value = "";
  adding.value = true;
}

function cancelAdd(): void {
  adding.value = false;
  draftError.value = "";
}

const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

// Derive an id from user input when the Name field is left blank.
// Covers the common shapes: a scoped npm package in stdio args
// (`@modelcontextprotocol/server-everything` → `everything`), or a
// hostname for an HTTP url (`mcp.deepwiki.com` → `deepwiki`).
function suggestIdFromDraft(state: DraftState): string {
  if (state.type === "http") {
    return suggestIdFromUrl(state.url.trim());
  }
  const args = state.argsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return suggestIdFromStdioArgs(args);
}

function suggestIdFromUrl(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname;
    const parts = host.split(".").filter((part) => part.length > 0);
    // Drop generic subdomain / TLD noise so `mcp.deepwiki.com` → `deepwiki`.
    const filtered = parts.filter(
      (part, i) => !(i === 0 && (part === "mcp" || part === "www" || part === "api")) && !(i === parts.length - 1 && /^[a-z]{2,4}$/.test(part)),
    );
    const candidate = filtered[0] ?? parts[0] ?? "";
    return slugifyToId(candidate);
  } catch {
    return "";
  }
}

function suggestIdFromStdioArgs(args: string[]): string {
  // First arg that isn't a flag is typically the package/script name.
  const payload = args.find((arg) => !arg.startsWith("-"));
  if (!payload) return "";
  // For scoped packages / paths, keep only the last segment.
  const lastSegment = payload.split("/").pop() ?? payload;
  // Strip common MCP naming prefixes so `server-everything` → `everything`.
  const stripped = lastSegment.replace(/^(mcp-server-|server-|mcp-)/, "").replace(/\.(?:[jt]s|mjs|cjs)$/, "");
  return slugifyToId(stripped);
}

function slugifyToId(raw: string): string {
  let slug = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  // Strip leading/trailing hyphens with explicit while-loops so the
  // regex engine can't be lured into catastrophic backtracking on a
  // crafted input.
  while (slug.startsWith("-")) slug = slug.slice(1);
  while (slug.endsWith("-")) slug = slug.slice(0, -1);
  slug = slug.slice(0, 64);
  // Must start with a lowercase letter.
  if (!/^[a-z]/.test(slug)) return "";
  return slug;
}

function ensureUniqueId(base: string): string {
  if (!base) return "";
  if (!props.servers.some((server) => server.id === base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!props.servers.some((server) => server.id === candidate)) return candidate;
  }
  return "";
}

function commitAdd(): void {
  let mcpId = draft.value.id.trim();
  if (!mcpId) {
    const suggested = ensureUniqueId(suggestIdFromDraft(draft.value));
    if (!suggested) {
      draftError.value = t("settingsMcpTab.errNoName");
      return;
    }
    mcpId = suggested;
  }
  if (!ID_RE.test(mcpId)) {
    draftError.value = t("settingsMcpTab.errBadName");
    return;
  }
  if (props.servers.some((server) => server.id === mcpId)) {
    draftError.value = t("settingsMcpTab.errIdExists", { id: mcpId });
    return;
  }
  let spec: ServerSpec;
  if (draft.value.type === "http") {
    const url = draft.value.url.trim();
    if (!/^https?:\/\//.test(url)) {
      draftError.value = t("settingsMcpTab.errBadHttpUrl");
      return;
    }
    spec = { type: "http", url, enabled: true };
  } else {
    const args = draft.value.argsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    spec = {
      type: "stdio",
      command: draft.value.command,
      args,
      enabled: true,
    };
  }
  emit("add", { id: mcpId, spec });
  adding.value = false;
  draftError.value = "";
}

// Called by the parent right before Save. If the draft form is open
// and has any input, commit it (auto-generating a Name if blank). If
// the draft is empty, silently close the form. Returns false only
// when validation fails so the parent can surface an error and abort
// the save — this is what spares users the pre-PR footgun of clicking
// Save without first clicking the inner Add button.
function flushDraft(): boolean {
  if (!adding.value) return true;
  const hasInput =
    draft.value.id.trim().length > 0 ||
    (draft.value.type === "http" && draft.value.url.trim().length > 0) ||
    (draft.value.type === "stdio" && draft.value.argsText.trim().length > 0);
  if (!hasInput) {
    cancelAdd();
    return true;
  }
  commitAdd();
  return !adding.value;
}

// Returns true while the add form is open AND has user-entered
// content. Lets the parent ask "will closing the modal discard
// typed text?" — an empty-open draft is fine to silently drop.
function hasPendingDraft(): boolean {
  if (!adding.value) return false;
  return (
    draft.value.id.trim().length > 0 ||
    draft.value.url.trim().length > 0 ||
    (draft.value.type === "stdio" && (draft.value.command.trim().length > 0 || draft.value.argsText.trim().length > 0))
  );
}

defineExpose({ flushDraft, hasPendingDraft });

function onToggleEnabled(index: number, event: Event): void {
  const target = event.target as HTMLInputElement;
  const entry = props.servers[index];
  if (!entry) return;
  emit("update", index, {
    ...entry,
    spec: { ...entry.spec, enabled: target.checked },
  });
}

function wouldRewriteLocalhost(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/.test(url);
}

function stdioHasNonWorkspaceArg(args?: string[]): boolean {
  if (!args) return false;
  return args.some((arg) => /^\//.test(arg) && arg !== "/workspace" && !arg.startsWith("/workspace/"));
}
</script>
