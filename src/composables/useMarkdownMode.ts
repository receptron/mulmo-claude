// Composable: markdown raw/rendered toggle persisted to localStorage.
// Extracted from FilesView.vue (#507 step 5).

import { ref } from "vue";

const MD_RAW_STORAGE_KEY = "files_md_raw_mode";

export function useMarkdownMode() {
  const mdRawMode = ref(localStorage.getItem(MD_RAW_STORAGE_KEY) === "true");

  function toggleMdRaw(): void {
    mdRawMode.value = !mdRawMode.value;
    localStorage.setItem(MD_RAW_STORAGE_KEY, String(mdRawMode.value));
  }

  return { mdRawMode, toggleMdRaw };
}
