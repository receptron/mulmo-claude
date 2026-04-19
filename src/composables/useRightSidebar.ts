// Composable for the right-sidebar (tool-history) visibility toggle.
//
// Persists the open/closed state to localStorage so user preference
// survives reloads. Kept out of the URL — this is pure "my personal
// UI choice" rather than a shareable view of the session.

import { ref, type Ref } from "vue";

const STORAGE_KEY = "right_sidebar_visible";

export function useRightSidebar(): {
  showRightSidebar: Ref<boolean>;
  toggleRightSidebar: () => void;
} {
  const showRightSidebar = ref(localStorage.getItem(STORAGE_KEY) === "true");

  function toggleRightSidebar(): void {
    showRightSidebar.value = !showRightSidebar.value;
    localStorage.setItem(STORAGE_KEY, String(showRightSidebar.value));
  }

  return { showRightSidebar, toggleRightSidebar };
}
