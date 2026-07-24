import type { Ref } from "vue";
import { useI18n } from "vue-i18n";
import { WIKI_ACTION } from "@mulmoclaude/core/wiki";
import { apiPost } from "../../../utils/api";
import { computeToggledContent } from "../helpers";

interface WikiPageSaveDeps {
  action: Ref<string>;
  content: Ref<string>;
  navError: Ref<string | null>;
  currentSlug: () => string | null;
  endpointBase: string;
  refresh: () => Promise<boolean>;
}

export interface WikiPageSave {
  onTaskCheckboxClick: (event: MouseEvent, target: HTMLInputElement) => void;
}

function revert(target: HTMLInputElement): void {
  target.checked = !target.checked;
}

// Serialised POST chain for rapid task-checkbox clicks (#775): each click queues
// onto the previous so a slower network can't reorder writes.
// `saveQueueGeneration` invalidates older queued saves after a failure-triggered
// refresh — their captured snapshots were computed against the now-discarded
// optimistic state, so writing them would overwrite canonical server content.
export function useWikiPageSave(deps: WikiPageSaveDeps): WikiPageSave {
  const { t } = useI18n();
  let taskPersistChain: Promise<unknown> = Promise.resolve();
  let saveQueueGeneration = 0;

  async function persistWikiPage(pageName: string, newContent: string, generation: number): Promise<void> {
    // Stale queued save (a previous save failed + refresh discarded the
    // optimistic state this snapshot was based on).
    if (generation !== saveQueueGeneration) return;
    // Navigation changed mid-flight — saving this snapshot to a different page
    // would clobber unrelated state; the route/result watchers already load it.
    if (deps.currentSlug() !== pageName) return;

    const response = await apiPost<{ data?: { content?: string } }>(deps.endpointBase, {
      action: WIKI_ACTION.save,
      pageName,
      content: newContent,
    });

    if (generation !== saveQueueGeneration) return;
    if (deps.currentSlug() !== pageName) return;

    if (!response.ok) {
      deps.navError.value = response.status === 0 ? response.error : `Wiki save failed (${response.status}): ${response.error}`;
      // The generation bump must come AFTER refresh: clicks arriving WHILE
      // refresh is in flight capture the pre-bump generation, so bumping
      // post-refresh invalidates them too.
      await deps.refresh();
      saveQueueGeneration += 1;
      return;
    }
    deps.navError.value = null;
  }

  // `.catch` keeps the chain self-healing: an uncaught rejection would leave the
  // chain permanently rejected and silently drop every later click. The error
  // is already surfaced via navError inside persistWikiPage.
  function queueSave(pageName: string, newContent: string): void {
    const generation = saveQueueGeneration;
    taskPersistChain = taskPersistChain.then(() => persistWikiPage(pageName, newContent, generation)).catch(() => undefined);
  }

  function onTaskCheckboxClick(event: MouseEvent, target: HTMLInputElement): void {
    const root = event.currentTarget;
    const pageName = deps.currentSlug();
    // Only the live page view persists toggles; everything else is read-only.
    if (deps.action.value !== WIKI_ACTION.page || !pageName || !(root instanceof HTMLElement)) {
      revert(target);
      return;
    }

    const result = computeToggledContent(target, root, deps.content.value);
    if (result.status !== "toggled") {
      // `mismatch` = source/DOM task-count drift; surface it. `skip` reverts
      // silently (target not among the tasks, or an out-of-range toggle).
      if (result.status === "mismatch") deps.navError.value = t("pluginWiki.taskCountMismatch");
      revert(target);
      return;
    }

    // Optimistic local update — re-render is driven by content's watcher.
    deps.content.value = result.content;
    deps.navError.value = null;
    queueSave(pageName, result.content);
  }

  return { onTaskCheckboxClick };
}
