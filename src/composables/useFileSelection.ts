// Composable: file selection, content loading with abort, URL sync.
// Extracted from FilesView.vue (#507 step 2).

import { ref } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

interface TextContent {
  kind: "text";
  path: string;
  content: string;
  size: number;
  modifiedMs: number;
}

interface MetaContent {
  kind: "image" | "pdf" | "audio" | "video" | "binary" | "too-large";
  path: string;
  size: number;
  modifiedMs: number;
  message?: string;
}

export type FileContent = TextContent | MetaContent;

/** Segment-wise traversal check: rejects `../` path components
 *  but allows legitimate filenames like `my..notes.txt`. */
export function isValidFilePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.startsWith("/")) return false;
  return !value.split("/").some((seg) => seg === "..");
}

export function useFileSelection() {
  const route = useRoute();
  const router = useRouter();

  const urlPath = route.query.path;
  const selectedPath = ref<string | null>(isValidFilePath(urlPath) ? urlPath : null);
  const content = ref<FileContent | null>(null);
  const contentLoading = ref(false);
  const contentError = ref<string | null>(null);

  let contentAbort: AbortController | null = null;

  async function loadContent(filePath: string): Promise<void> {
    contentAbort?.abort();
    const controller = new AbortController();
    contentAbort = controller;

    contentLoading.value = true;
    contentError.value = null;
    content.value = null;
    try {
      const result = await apiGet<FileContent>(API_ROUTES.files.content, { path: filePath }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!result.ok) {
        contentError.value = result.error;
      } else {
        content.value = result.data;
      }
    } finally {
      if (contentAbort === controller) {
        contentLoading.value = false;
        contentAbort = null;
      }
    }
  }

  function selectFile(filePath: string): void {
    selectedPath.value = filePath;
    loadContent(filePath);
    const { path: __path, ...restQuery } = route.query;
    router.push({ query: { ...restQuery, path: filePath } }).catch((err: unknown) => {
      if (!isNavigationFailure(err)) {
        // Frontend composable — server logger not available.
        // console.error is the standard pattern in Vue composables.
        console.error("[selectFile] navigation failed:", err);
      }
    });
  }

  function deselectFile(): void {
    contentAbort?.abort();
    contentAbort = null;
    selectedPath.value = null;
    content.value = null;
    contentLoading.value = false;
    contentError.value = null;
    const { path: __path, ...restQuery } = route.query;
    router.replace({ query: restQuery }).catch((err: unknown) => {
      if (!isNavigationFailure(err)) {
        console.error("[deselectFile] navigation failed:", err);
      }
    });
  }

  function abortContent(): void {
    contentAbort?.abort();
    contentAbort = null;
    contentLoading.value = false;
  }

  return {
    selectedPath,
    content,
    contentLoading,
    contentError,
    loadContent,
    selectFile,
    deselectFile,
    abortContent,
  };
}
