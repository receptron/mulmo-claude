// Composable: file selection, content loading with abort, URL sync.
// Extracted from FilesView.vue (#507 step 2).

import { ref } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { isNonEmptyString } from "../utils/types";

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

/**
 * Extract the logical file path from a route's `pathMatch` param.
 * Vue Router hands the repeatable catch-all back as an array, a
 * single string, or `undefined` depending on what matched — normalise
 * to a `string | null` so the rest of the composable doesn't care.
 */
export function readPathMatch(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    return raw.join("/");
  }
  if (isNonEmptyString(raw)) return raw;
  return null;
}

export function useFileSelection() {
  const route = useRoute();
  const router = useRouter();

  const pathFromRoute = readPathMatch(route.params.pathMatch);
  const selectedPath = ref<string | null>(isValidFilePath(pathFromRoute) ? pathFromRoute : null);
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
    // Pass segments as an array so Vue Router encodes each segment
    // independently (spaces / multi-byte / `?#%` get UTF-8 percent-
    // encoding), while slashes stay as path separators. Passing the
    // joined string would urlencode `/` → `%2F` and collapse the
    // visible path shape.
    router.push({ name: "files", params: { pathMatch: filePath.split("/") }, query: route.query }).catch((err: unknown) => {
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
    router.replace({ name: "files", params: { pathMatch: [] }, query: route.query }).catch((err: unknown) => {
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
