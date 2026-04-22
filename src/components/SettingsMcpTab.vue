<template>
  <div class="space-y-3">
    <p class="text-xs text-gray-600 leading-relaxed">
      Add external MCP servers. HTTP servers work in every mode. Stdio servers use the sandbox image's
      <code class="bg-gray-100 px-1 rounded">npx</code> / <code class="bg-gray-100 px-1 rounded">node</code> /
      <code class="bg-gray-100 px-1 rounded">tsx</code>; paths must live under the workspace when Docker is enabled.
    </p>

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
          <div v-if="dockerMode && wouldRewriteLocalhost((entry.spec as HttpSpec).url)" class="text-amber-700">
            In Docker mode <code>localhost</code> is rewritten to <code>host.docker.internal</code>.
          </div>
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
import { ref } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

// UI-local representation of a configured server. Matches
// server/config.ts#McpServerEntry. Re-declared here to avoid a
// cross-module type import from the server package.
export interface HttpSpec {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}
export interface StdioSpec {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}
export type ServerSpec = HttpSpec | StdioSpec;
export interface McpServerEntry {
  id: string;
  spec: ServerSpec;
}

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

defineExpose({ flushDraft });

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
