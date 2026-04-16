<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div
      class="px-4 py-2 border-b border-gray-100 shrink-0 flex items-center justify-between gap-2"
    >
      <span class="text-sm font-medium text-gray-700 truncate">
        Information sources
      </span>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs text-gray-500">
          {{ sources.length }} source{{ sources.length === 1 ? "" : "s" }}
        </span>
        <button
          class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          :disabled="adding || busy === 'rebuild'"
          data-testid="sources-add-btn"
          @click="startAdd"
        >
          <span class="material-icons text-sm align-middle">add</span>
          Add
        </button>
        <button
          class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          :disabled="busy === 'rebuild'"
          data-testid="sources-rebuild-btn"
          @click="rebuild"
        >
          <span class="material-icons text-sm align-middle">refresh</span>
          {{ busy === "rebuild" ? "Rebuilding…" : "Rebuild now" }}
        </button>
      </div>
    </div>

    <div
      v-if="adding"
      class="px-4 py-3 border-b border-blue-200 bg-blue-50/50 shrink-0 space-y-2"
      data-testid="sources-add-form"
    >
      <div class="flex flex-wrap items-center gap-2">
        <label class="text-xs text-gray-700">
          Type
          <select
            v-model="draft.kind"
            class="ml-1 text-xs border border-gray-300 rounded px-1 py-0.5"
            data-testid="sources-draft-kind"
            @change="onKindChange"
          >
            <option value="rss">RSS</option>
            <option value="github-releases">GitHub releases</option>
            <option value="github-issues">GitHub issues</option>
            <option value="arxiv">arXiv</option>
          </select>
        </label>
        <input
          v-model="draft.primary"
          class="flex-1 min-w-[12rem] text-xs border border-gray-300 rounded px-2 py-1 font-mono"
          :placeholder="primaryPlaceholder"
          data-testid="sources-draft-primary"
          @keydown.enter="commitAdd"
        />
        <input
          v-model="draft.title"
          class="w-40 text-xs border border-gray-300 rounded px-2 py-1"
          placeholder="Title (optional)"
          data-testid="sources-draft-title"
          @keydown.enter="commitAdd"
        />
      </div>
      <div class="flex items-center justify-between text-xs">
        <span class="text-gray-500">
          {{ primaryHint }}
        </span>
        <div class="flex gap-2">
          <button
            class="px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
            data-testid="sources-draft-cancel"
            @click="cancelAdd"
          >
            Cancel
          </button>
          <button
            class="px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
            :disabled="busy === 'add' || !draft.primary.trim()"
            data-testid="sources-draft-add"
            @click="commitAdd"
          >
            {{ busy === "add" ? "Adding…" : "Add + Rebuild" }}
          </button>
        </div>
      </div>
      <div
        v-if="draftError"
        class="text-xs text-red-600"
        data-testid="sources-draft-error"
      >
        {{ draftError }}
      </div>
    </div>

    <div
      v-if="actionMessage"
      class="px-4 py-2 text-xs border-b shrink-0"
      :class="
        actionError
          ? 'bg-red-50 text-red-700 border-red-200'
          : 'bg-green-50 text-green-700 border-green-200'
      "
      data-testid="sources-action-message"
    >
      {{ actionMessage }}
    </div>

    <div class="flex-1 overflow-y-auto">
      <div
        v-if="sources.length === 0"
        class="flex flex-col items-center justify-center h-full p-6 gap-4"
        data-testid="sources-empty"
      >
        <p class="text-sm text-gray-500 italic text-center max-w-md">
          No sources registered yet. Pick a starter pack below, click
          <strong>+ Add</strong> above, or ask Claude to register one.
        </p>
        <div class="w-full max-w-md space-y-2" data-testid="sources-presets">
          <button
            v-for="preset in PRESETS"
            :key="preset.id"
            class="w-full text-left border border-gray-200 rounded-lg p-3 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:border-gray-200"
            :disabled="busy === 'preset-' + preset.id"
            :data-testid="`sources-preset-${preset.id}`"
            @click="installPreset(preset)"
          >
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-sm font-medium text-gray-800">
                {{ preset.label }}
              </span>
              <span class="text-[11px] text-gray-500 shrink-0">
                {{ preset.entries.length }} source{{
                  preset.entries.length === 1 ? "" : "s"
                }}
              </span>
            </div>
            <div class="text-xs text-gray-500 mt-1">
              {{ preset.description }}
            </div>
            <div
              v-if="busy === 'preset-' + preset.id"
              class="text-xs text-blue-600 mt-1 italic"
            >
              Registering + fetching…
            </div>
          </button>
        </div>
      </div>
      <ul v-else class="divide-y divide-gray-100 border-b border-gray-100">
        <li
          v-for="source in sources"
          :key="source.slug"
          class="px-4 py-3 flex items-start gap-3"
          :class="{
            'bg-amber-50': source.slug === highlightSlug,
          }"
          :data-testid="`source-row-${source.slug}`"
        >
          <span
            class="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 mt-0.5 shrink-0"
            :class="kindBadgeClass(source.fetcherKind)"
          >
            {{ kindLabel(source.fetcherKind) }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-2">
              <a
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm font-medium text-blue-700 hover:underline truncate"
              >
                {{ source.title }}
              </a>
              <code class="text-[11px] text-gray-400 shrink-0">
                {{ source.slug }}
              </code>
            </div>
            <div class="text-xs text-gray-500 truncate">
              {{ source.url }}
            </div>
            <div
              v-if="source.categories.length > 0"
              class="mt-1 flex flex-wrap gap-1"
            >
              <span
                v-for="cat in source.categories"
                :key="cat"
                class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600"
              >
                {{ cat }}
              </span>
            </div>
            <div v-if="source.notes" class="mt-1 text-xs text-gray-600 italic">
              {{ source.notes }}
            </div>
          </div>
          <button
            class="text-xs text-red-600 hover:text-red-800 shrink-0 disabled:opacity-50"
            :disabled="busy === source.slug"
            :data-testid="`source-remove-${source.slug}`"
            @click="remove(source.slug)"
          >
            {{ busy === source.slug ? "Removing…" : "Remove" }}
          </button>
        </li>
      </ul>

      <!-- Today's brief. Auto-fetched on mount and refreshed after
           every Rebuild. Rendered as markdown so lists / headings
           feel like a document, not a dump. -->
      <div
        v-if="sources.length > 0 && (briefLoading || briefHtml || briefError)"
        class="p-4"
        data-testid="sources-brief"
      >
        <div class="flex items-baseline justify-between mb-2">
          <h3 class="text-sm font-semibold text-gray-800">
            Today's brief
            <span v-if="briefDate" class="text-xs text-gray-400 font-normal">
              ({{ briefDate }})
            </span>
          </h3>
          <button
            v-if="briefFilePath"
            class="text-[11px] text-gray-500 hover:text-gray-700"
            :title="briefFilePath"
          >
            {{ briefFilePath }}
          </button>
        </div>
        <div v-if="briefLoading" class="text-xs text-gray-500 italic">
          Loading today's brief…
        </div>
        <div
          v-else-if="briefError"
          class="text-xs text-gray-500 italic"
          data-testid="sources-brief-empty"
        >
          {{ briefError }}
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else class="markdown-content" v-html="briefHtml" />
      </div>
    </div>

    <div
      v-if="lastRebuild"
      class="px-4 py-2 border-t border-gray-100 shrink-0 text-xs text-gray-600"
      data-testid="sources-rebuild-summary"
    >
      Last rebuild ({{ lastRebuild.isoDate }}):
      <strong>{{ lastRebuild.itemCount }}</strong> items from
      <strong>{{ lastRebuild.plannedCount }}</strong> sources,
      <strong>{{ lastRebuild.duplicateCount }}</strong> duplicates dropped.
      <span v-if="lastRebuild.archiveErrors.length > 0" class="text-red-600">
        ({{ lastRebuild.archiveErrors.length }} archive errors)
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import type { ManageSourceData, RebuildSummary, Source } from "./index";
import { apiGet, apiPost, apiDelete } from "../../utils/api";
import { API_ROUTES } from "../../config/apiRoutes";

const props = defineProps<{
  selectedResult: ToolResultComplete<ManageSourceData>;
}>();

// Local mirror of the source list that we mutate after Remove /
// Rebuild button clicks, so the UI stays responsive without the LLM
// having to re-list. Initial value comes from the tool result.
const localSources = ref<Source[] | null>(null);
const lastRebuild = ref<RebuildSummary | null>(null);
const actionMessage = ref("");
const actionError = ref(false);
// Tracks the current button-driven request: "rebuild", "add", or a
// slug (Remove). Used to disable/relabel the matching button.
const busy = ref<string | null>(null);

// --- Add source form state ---------------------------------------------

type DraftKind = "rss" | "github-releases" | "github-issues" | "arxiv";
interface DraftState {
  kind: DraftKind;
  primary: string; // Feed URL / repo URL / repo slug / arxiv query
  title: string;
}

const adding = ref(false);
const draft = ref<DraftState>(emptyDraft());
const draftError = ref("");

function emptyDraft(): DraftState {
  return { kind: "rss", primary: "", title: "" };
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

function onKindChange(): void {
  draftError.value = "";
}

const primaryPlaceholder = computed(() => {
  switch (draft.value.kind) {
    case "rss":
      return "https://news.ycombinator.com/rss";
    case "github-releases":
    case "github-issues":
      return "https://github.com/owner/repo  (or owner/repo)";
    case "arxiv":
      return "cat:cs.CL";
  }
  return "";
});

const primaryHint = computed(() => {
  switch (draft.value.kind) {
    case "rss":
      return "Feed URL (RSS 2.0 / Atom / RDF)";
    case "github-releases":
      return "GitHub repo URL or owner/repo — fetches releases";
    case "github-issues":
      return "GitHub repo URL or owner/repo — fetches issues";
    case "arxiv":
      return "arXiv search query (e.g. cat:cs.CL or au:hinton)";
  }
  return "";
});

// Extract owner/repo from either a full github.com URL or a bare
// "owner/repo" string. Returns null when the input doesn't look
// like a recognisable GitHub repo.
function parseRepoSlug(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)/i,
  );
  if (urlMatch) return `${urlMatch[1]}/${urlMatch[2].replace(/\.git$/, "")}`;
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) return trimmed.replace(/\.git$/, "");
  return null;
}

// Build the /api/sources body from the draft. Returns an error
// string when the input is invalid for the chosen kind.
interface RegisterPayload {
  title: string;
  url: string;
  fetcherKind: DraftKind;
  fetcherParams: Record<string, string>;
}

function buildRegisterPayload(d: DraftState): RegisterPayload | string {
  const primary = d.primary.trim();
  const title = d.title.trim();
  if (!primary) return "Please fill in the URL / query field.";
  switch (d.kind) {
    case "rss": {
      if (!/^https?:\/\//i.test(primary)) {
        return "RSS feed URL must start with http:// or https://";
      }
      let hostname: string;
      try {
        hostname = new URL(primary).hostname;
      } catch {
        return "RSS feed URL is not a valid URL.";
      }
      if (!hostname) {
        return "RSS feed URL must include a host.";
      }
      return {
        title: title || hostname,
        url: primary,
        fetcherKind: "rss",
        fetcherParams: { rss_url: primary },
      };
    }
    case "github-releases":
    case "github-issues": {
      const slug = parseRepoSlug(primary);
      if (!slug) {
        return "Enter a GitHub repo URL (https://github.com/owner/repo) or owner/repo.";
      }
      return {
        title: title || slug,
        url: `https://github.com/${slug}`,
        fetcherKind: d.kind,
        fetcherParams: { github_repo: slug },
      };
    }
    case "arxiv": {
      const query = primary;
      return {
        title: title || `arXiv: ${query}`,
        url: `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}`,
        fetcherKind: "arxiv",
        fetcherParams: { arxiv_query: query },
      };
    }
  }
  return "Unsupported fetcher kind.";
}

async function commitAdd(): Promise<void> {
  const payload = buildRegisterPayload(draft.value);
  if (typeof payload === "string") {
    draftError.value = payload;
    return;
  }
  draftError.value = "";
  busy.value = "add";
  const response = await apiPost<unknown>(API_ROUTES.sources.create, payload);
  if (!response.ok) {
    draftError.value = response.error || "Failed to register source";
    busy.value = null;
    return;
  }
  flash(`Registered. Fetching new items…`);
  adding.value = false;
  await refreshList();
  // C: auto-rebuild so the user sees items without an extra click.
  busy.value = "rebuild";
  await rebuildInline();
  busy.value = null;
}

// --- Starter-pack presets ----------------------------------------------

interface PresetEntry {
  slug: string;
  title: string;
  url: string;
  fetcherKind: "rss" | "github-releases" | "github-issues" | "arxiv";
  fetcherParams: Record<string, string>;
  categories?: string[];
}

interface Preset {
  id: string;
  label: string;
  description: string;
  entries: PresetEntry[];
}

const PRESETS: Preset[] = [
  {
    id: "tech-news",
    label: "Tech news",
    description: "Hacker News front page — daily tech headlines.",
    entries: [
      {
        slug: "hacker-news",
        title: "Hacker News",
        url: "https://news.ycombinator.com/rss",
        fetcherKind: "rss",
        fetcherParams: { rss_url: "https://news.ycombinator.com/rss" },
        categories: ["tech-news", "startup"],
      },
    ],
  },
  {
    id: "ai-research",
    label: "AI research",
    description:
      "Latest arXiv papers in NLP (cs.CL) and machine learning (cs.LG).",
    entries: [
      {
        slug: "arxiv-cs-cl",
        title: "arXiv cs.CL",
        url: "https://export.arxiv.org/api/query?search_query=cat:cs.CL",
        fetcherKind: "arxiv",
        fetcherParams: { arxiv_query: "cat:cs.CL" },
        categories: ["ai", "research"],
      },
      {
        slug: "arxiv-cs-lg",
        title: "arXiv cs.LG",
        url: "https://export.arxiv.org/api/query?search_query=cat:cs.LG",
        fetcherKind: "arxiv",
        fetcherParams: { arxiv_query: "cat:cs.LG" },
        categories: ["ai", "research"],
      },
    ],
  },
  {
    id: "claude-code",
    label: "Claude Code updates",
    description:
      "New releases of the Claude Code CLI from the anthropics/claude-code repo.",
    entries: [
      {
        slug: "claude-code-releases",
        title: "Claude Code releases",
        url: "https://github.com/anthropics/claude-code",
        fetcherKind: "github-releases",
        fetcherParams: { github_repo: "anthropics/claude-code" },
        categories: ["ai", "tech-news"],
      },
    ],
  },
];

async function installPreset(preset: Preset): Promise<void> {
  busy.value = `preset-${preset.id}`;
  const alreadyHave = new Set(sources.value.map((s) => s.slug));
  const toRegister = preset.entries.filter((e) => !alreadyHave.has(e.slug));
  if (toRegister.length === 0) {
    flash(`All sources in "${preset.label}" are already registered.`);
    busy.value = null;
    return;
  }
  const failures: string[] = [];
  for (const entry of toRegister) {
    const response = await apiPost<unknown>(API_ROUTES.sources.create, {
      slug: entry.slug,
      title: entry.title,
      url: entry.url,
      fetcherKind: entry.fetcherKind,
      fetcherParams: entry.fetcherParams,
      // Presets know their categories — skip the classifier
      // CLI call so the first brief is ready sooner.
      categories: entry.categories,
      skipClassify: true,
    });
    if (!response.ok) {
      failures.push(`${entry.slug}: ${response.error}`);
    }
  }
  if (failures.length > 0) {
    flash(
      `Registered ${toRegister.length - failures.length}/${toRegister.length}. Errors: ${failures.join("; ")}`,
      true,
    );
  } else {
    flash(
      `Registered ${toRegister.length} source${toRegister.length === 1 ? "" : "s"} from "${preset.label}". Fetching…`,
    );
  }
  await refreshList();
  await rebuildInline();
  busy.value = null;
}

// Rebuild step extracted so commitAdd can chain it without recursing
// into rebuild()'s own busy-state machine.
async function rebuildInline(): Promise<void> {
  const response = await apiPost<RebuildSummary>(API_ROUTES.sources.rebuild);
  if (!response.ok) {
    flash(`Register succeeded but rebuild failed: ${response.error}`, true);
    return;
  }
  const summary = response.data;
  lastRebuild.value = summary;
  flash(
    `Ready: ${summary.itemCount} items from ${summary.plannedCount} source${summary.plannedCount === 1 ? "" : "s"}.`,
  );
  await loadBrief(summary.isoDate);
}

const sources = computed<Source[]>(() => {
  if (localSources.value !== null) return localSources.value;
  return props.selectedResult.data?.sources ?? [];
});

const highlightSlug = computed(
  () => props.selectedResult.data?.highlightSlug ?? null,
);

// Initialize lastRebuild from the result if the LLM-side rebuild
// landed before any in-View button click — but never overwrite a
// fresher result the user's own click produced.
if (
  lastRebuild.value === null &&
  props.selectedResult.data?.lastRebuild !== undefined
) {
  lastRebuild.value = props.selectedResult.data.lastRebuild;
}

// Re-sync the local mirrors when the caller selects a different
// manageSource result (e.g. a new tool_result from the LLM). The
// existing "never overwrite fresher in-View state" guard still
// applies — we only accept the prop value when it's strictly
// newer than what the View has.
watch(
  () => props.selectedResult.uuid,
  () => {
    const incoming = props.selectedResult.data;
    if (!incoming) return;
    // Replace the source list wholesale — the prop's snapshot is
    // authoritative when the user switches between results.
    localSources.value = incoming.sources ?? [];
    const nextRebuild = incoming.lastRebuild;
    if (
      nextRebuild &&
      (!lastRebuild.value || nextRebuild.isoDate >= lastRebuild.value.isoDate)
    ) {
      lastRebuild.value = nextRebuild;
    }
  },
);

function kindLabel(kind: Source["fetcherKind"]): string {
  switch (kind) {
    case "rss":
      return "RSS";
    case "github-releases":
      return "GitHub rel";
    case "github-issues":
      return "GitHub iss";
    case "arxiv":
      return "arXiv";
  }
}

function kindBadgeClass(kind: Source["fetcherKind"]): string {
  switch (kind) {
    case "rss":
      return "bg-orange-100 text-orange-700";
    case "github-releases":
      return "bg-purple-100 text-purple-700";
    case "github-issues":
      return "bg-indigo-100 text-indigo-700";
    case "arxiv":
      return "bg-emerald-100 text-emerald-700";
  }
}

function flash(message: string, isError = false): void {
  actionMessage.value = message;
  actionError.value = isError;
  setTimeout(() => {
    if (actionMessage.value === message) actionMessage.value = "";
  }, 4000);
}

async function refreshList(): Promise<void> {
  const response = await apiGet<{ sources: Source[] }>(API_ROUTES.sources.list);
  if (!response.ok) {
    flash(`Failed to refresh sources: ${response.error}`, true);
    return;
  }
  localSources.value = response.data.sources;
}

async function remove(slug: string): Promise<void> {
  if (!confirm(`Remove source "${slug}"?`)) return;
  busy.value = slug;
  const response = await apiDelete<unknown>(
    API_ROUTES.sources.remove.replace(":slug", encodeURIComponent(slug)),
  );
  busy.value = null;
  if (!response.ok) {
    flash(`Remove failed: ${response.error}`, true);
    return;
  }
  flash(`Removed "${slug}".`);
  await refreshList();
}

async function rebuild(): Promise<void> {
  busy.value = "rebuild";
  const response = await apiPost<RebuildSummary>(API_ROUTES.sources.rebuild);
  if (!response.ok) {
    flash(`Rebuild failed: ${response.error}`, true);
    busy.value = null;
    return;
  }
  const summary = response.data;
  lastRebuild.value = summary;
  flash(
    `Rebuild complete: ${summary.itemCount} items from ${summary.plannedCount} sources.`,
  );
  await Promise.all([refreshList(), loadBrief(summary.isoDate)]);
  busy.value = null;
}

// --- today's brief -------------------------------------------------------

// Fetched markdown (rendered via marked() into briefHtml below). Null
// while idle; "" after a confirmed empty/404 so the template can show
// a friendly message instead of a stuck spinner.
const briefMarkdown = ref<string | null>(null);
const briefError = ref("");
const briefLoading = ref(false);
const briefDate = ref("");
const briefFilePath = ref("");

// Build `news/daily/YYYY/MM/DD.md` from an ISO date. Local-time
// matches how the pipeline writes the file (see toLocalIsoDate).
function dailyPathFor(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `news/daily/${y}/${m}/${d}.md`;
}

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Monotonically-increasing token so concurrent loadBrief() calls
// (mount + rebuild + prop watch racing on slow networks) can drop
// stale responses that resolve after a newer one has already
// settled the state. Without this, an older fetch finishing last
// would clobber the latest brief.
let briefLoadToken = 0;

async function loadBrief(isoDate: string): Promise<void> {
  const token = ++briefLoadToken;
  briefLoading.value = true;
  briefError.value = "";
  briefDate.value = isoDate;
  const relPath = dailyPathFor(isoDate);
  briefFilePath.value = relPath;
  const response = await apiGet<{ content?: string; kind?: string }>(
    API_ROUTES.files.content,
    { path: relPath },
  );
  if (token !== briefLoadToken) return;
  if (!response.ok) {
    if (response.status === 404) {
      briefMarkdown.value = "";
      briefError.value =
        "No brief written for this date yet. Click Rebuild now.";
    } else {
      briefError.value = response.error || "Failed to load brief";
    }
    briefLoading.value = false;
    return;
  }
  briefMarkdown.value = response.data.content ?? "";
  if (!briefMarkdown.value.trim()) {
    briefError.value = "Today's brief is empty.";
  }
  briefLoading.value = false;
}

// The daily file ends with a trailing ```json block that carries
// the structured item list for later machine consumption (Q2 of the
// plan: "Markdown + trailing fenced JSON block"). Strip it for the
// human-facing render so the UI doesn't dump a 1000-line JSON blob
// after the brief. The file on disk stays unchanged.
function stripTrailingJsonBlock(markdown: string): string {
  const marker = "\n```json\n";
  const idx = markdown.lastIndexOf(marker);
  if (idx < 0) return markdown;
  // Only strip if everything after the marker looks like it belongs
  // to that block (i.e. it's the last fenced block in the file).
  const tail = markdown.slice(idx);
  if (!tail.trimEnd().endsWith("```")) return markdown;
  return markdown.slice(0, idx).trimEnd();
}

const briefHtml = computed(() => {
  if (!briefMarkdown.value) return "";
  const body = stripTrailingJsonBlock(briefMarkdown.value);
  // marked() preserves raw HTML embedded in the markdown (RSS
  // content:encoded blocks often carry tracking pixels, iframes,
  // inline <script> from scraped sources). Sanitize before
  // binding to v-html.
  return DOMPurify.sanitize(marked(body) as string);
});

// Load on mount — try today's brief first, then last rebuild's date
// if different (tool result may have been produced earlier in the day
// but the user only just opened this canvas).
onMounted(() => {
  const initial = lastRebuild.value?.isoDate ?? todayIsoDate();
  loadBrief(initial);
});

// Re-fetch when the selected result brings a new rebuild summary
// (e.g. the LLM triggered another rebuild).
watch(
  () => props.selectedResult.data?.lastRebuild?.isoDate,
  (next) => {
    if (next && next !== briefDate.value) loadBrief(next);
  },
);
</script>
