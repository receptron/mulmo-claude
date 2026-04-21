// Composable: file-tree sort mode ("name" | "recent") persisted to
// localStorage. Applied globally across every directory in the Files
// view; only affects within-group order (dirs-first grouping stays).

import { ref } from "vue";

const SORT_MODE_STORAGE_KEY = "files_sort_mode";

export type FileSortMode = "name" | "recent";

function readStoredMode(): FileSortMode {
  return localStorage.getItem(SORT_MODE_STORAGE_KEY) === "recent" ? "recent" : "name";
}

export function useFileSortMode() {
  const sortMode = ref<FileSortMode>(readStoredMode());

  function setSortMode(mode: FileSortMode): void {
    sortMode.value = mode;
    localStorage.setItem(SORT_MODE_STORAGE_KEY, mode);
  }

  return { sortMode, setSortMode };
}
