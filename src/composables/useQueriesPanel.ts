// Composable for the role-specific "quick queries" panel in the
// chat footer.
//
// Owns the expanded/collapsed flag, the scrollable list's template
// ref, and the click handler. When expanded, the list auto-scrolls
// to its bottom so the most recent/relevant query is visible. On
// click, Shift fills the input (for editing) and plain click
// submits the query immediately.

import { nextTick, ref, watch, type Ref } from "vue";

interface UseQueriesPanelDeps {
  /** The chat input ref, populated on Shift+click. */
  userInput: Ref<string>;
  /** The textarea DOM ref, focused after Shift+click. */
  textareaRef: Ref<HTMLTextAreaElement | null>;
  /** Invoked on plain click to send the query as a message. */
  sendMessage: (message: string) => void;
}

export function useQueriesPanel(deps: UseQueriesPanelDeps): {
  queriesExpanded: Ref<boolean>;
  queriesListRef: Ref<HTMLDivElement | null>;
  onQueryClick: (e: MouseEvent, query: string) => void;
} {
  const queriesExpanded = ref(false);
  const queriesListRef = ref<HTMLDivElement | null>(null);

  watch(queriesExpanded, (expanded) => {
    if (!expanded) return;
    nextTick(() => {
      if (queriesListRef.value) {
        queriesListRef.value.scrollTop = queriesListRef.value.scrollHeight;
      }
    });
  });

  function onQueryClick(e: MouseEvent, query: string): void {
    queriesExpanded.value = false;
    if (e.shiftKey) {
      deps.userInput.value = query;
      nextTick(() => deps.textareaRef.value?.focus());
      return;
    }
    deps.sendMessage(query);
  }

  return { queriesExpanded, queriesListRef, onQueryClick };
}
