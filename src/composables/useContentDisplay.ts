// Composable: derive content-type flags and formatted views from the
// current selection. Extracted from FilesView.vue (#507 step 5).

import { computed, watch, type Ref } from "vue";
import type { FileContent } from "./useFileContentLoader";
import { wrapHtmlWithPreviewCsp } from "../utils/html/previewCsp";
import { cspExtra, loadCspExtra } from "./useCspExtra";
import { tokenizeJson, tokenizeJsonl, prettyJson } from "../utils/format/jsonSyntax";
import { parseFrontmatter } from "@mulmoclaude/markdown-utils/markdown/frontmatter";

function hasExt(filePath: string | null, exts: string[]): boolean {
  if (!filePath) return false;
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

// Workspace-relative prefix of HTML artifacts that the server exposes
// as a path-based static mount (`server/index.ts` → `/artifacts/html`).
// Files-view previews under this prefix load via iframe `src=...`, so
// the browser resolves relative refs (`<img src="../images/...">`)
// against the file's real URL instead of `about:srcdoc`. Files
// elsewhere fall back to the existing `srcdoc` path.
const HTML_PREVIEW_DIR_PREFIX = "artifacts/html/";

export function htmlPreviewUrlFor(filePath: string | null): string | null {
  if (!filePath) return null;
  const lower = filePath.toLowerCase();
  if (!lower.endsWith(".html") && !lower.endsWith(".htm")) return null;
  if (!filePath.startsWith(HTML_PREVIEW_DIR_PREFIX)) return null;
  const rest = filePath.slice(HTML_PREVIEW_DIR_PREFIX.length);
  if (rest.length === 0) return null;
  return `/artifacts/html/${rest.split("/").map(encodeURIComponent).join("/")}`;
}

// SVG artifacts are served by the `/artifacts/svg` static mount —
// loaded into View / Preview via `<img src=...>`. The browser refuses
// to execute `<script>` inside an SVG loaded as `<img>`, so a CSP
// header is unnecessary on the server side. Same per-segment encode
// pattern as the HTML helper so titles with spaces / `?` survive.
const SVG_PREVIEW_DIR_PREFIX = "artifacts/svg/";

export function svgPreviewUrlFor(filePath: string | null): string | null {
  if (!filePath) return null;
  if (!filePath.toLowerCase().endsWith(".svg")) return null;
  if (!filePath.startsWith(SVG_PREVIEW_DIR_PREFIX)) return null;
  const rest = filePath.slice(SVG_PREVIEW_DIR_PREFIX.length);
  if (rest.length === 0) return null;
  return `/artifacts/svg/${rest.split("/").map(encodeURIComponent).join("/")}`;
}

export function useContentDisplay(selectedPath: Ref<string | null>, content: Ref<FileContent | null>) {
  const isMarkdown = computed(() => hasExt(selectedPath.value, [".md", ".markdown"]));
  const isHtml = computed(() => hasExt(selectedPath.value, [".html", ".htm"]));
  const isJson = computed(() => hasExt(selectedPath.value, [".json"]));
  const isJsonl = computed(() => hasExt(selectedPath.value, [".jsonl", ".ndjson"]));

  const sandboxedHtml = computed(() => (content.value?.kind === "text" && isHtml.value ? wrapHtmlWithPreviewCsp(content.value.content, cspExtra.value) : ""));

  // Keep `config/csp.json` edits live for the srcdoc HTML preview (files NOT
  // under artifacts/html/, which the server-header path already covers): refresh
  // the cached extra whenever an HTML file is shown so `sandboxedHtml` — which
  // depends on `cspExtra` — rebuilds with the current policy on the next open,
  // not only after a full app reload. Best-effort; a stale value just means the
  // previous policy until the fetch lands.
  watch(
    () => content.value?.kind === "text" && isHtml.value,
    (isHtmlPreview) => {
      if (isHtmlPreview) void loadCspExtra();
    },
    { immediate: true },
  );

  // When the selected file is HTML and lives under `artifacts/html/`,
  // expose a server-served URL so the iframe can load via `src=` and
  // get a real base URL for relative-path resolution. `null` for
  // anything else — caller falls back to `sandboxedHtml` (srcdoc).
  const htmlPreviewUrl = computed<string | null>(() => (isHtml.value ? htmlPreviewUrlFor(selectedPath.value) : null));

  const jsonTokens = computed(() => {
    if (!content.value || content.value.kind !== "text") return [];
    if (!isJson.value) return [];
    return tokenizeJson(prettyJson(content.value.content));
  });

  const jsonlLines = computed(() => {
    if (!content.value || content.value.kind !== "text") return [];
    if (!isJsonl.value) return [];
    return tokenizeJsonl(content.value.content);
  });

  // Returns the canonical `ParsedMarkdown` shape (`{ meta, body,
  // hasHeader }`) augmented with an ordered `fields` array for the
  // properties-panel template. Templates iterate `fields` and
  // branch on `Array.isArray(value)` for chip rendering.
  const mdFrontmatter = computed(() => {
    if (!content.value || content.value.kind !== "text") return null;
    if (!isMarkdown.value) return null;
    const parsed = parseFrontmatter(content.value.content);
    const fields = Object.entries(parsed.meta).map(([key, value]) => ({ key, value }));
    return { ...parsed, fields };
  });

  return {
    isMarkdown,
    isHtml,
    isJson,
    isJsonl,
    sandboxedHtml,
    htmlPreviewUrl,
    jsonTokens,
    jsonlLines,
    mdFrontmatter,
  };
}
